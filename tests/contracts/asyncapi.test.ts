import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  AUDIO_CONTROL_TYPES,
  AUDIO_PROTOCOL_VERSION,
  assertAudioChunkHeader,
  decodeAudioFrame,
  encodeAudioFrame,
} from "@/realtime/audio-protocol";
import { REALTIME_EVENT_TYPES } from "@/server/platform-repository";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object`);
  }
  return value as JsonObject;
}

function asObjectArray(value: unknown, label: string): JsonObject[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value.map((item, index) => asObject(item, `${label}[${index}]`));
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new TypeError(`${label} must be a string array`);
  }
  return value as string[];
}

function property(object: JsonObject, key: string): JsonObject {
  return asObject(object[key], key);
}

function collectLocalRefs(value: unknown, refs: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectLocalRefs(item, refs);
    return refs;
  }
  if (value === null || typeof value !== "object") return refs;
  for (const [key, item] of Object.entries(value)) {
    if (key === "$ref" && typeof item === "string" && item.startsWith("#/")) refs.push(item);
    collectLocalRefs(item, refs);
  }
  return refs;
}

function resolveLocalRef(root: JsonObject, ref: string): unknown {
  return ref
    .slice(2)
    .split("/")
    .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce<unknown>((value, token) => asObject(value, ref)[token], root);
}

const document = asObject(
  JSON.parse(readFileSync(new URL("../../contracts/asyncapi.json", import.meta.url), "utf8")),
  "AsyncAPI document",
);
const channels = property(document, "channels");
const operations = property(document, "operations");
const components = property(document, "components");
const componentMessages = property(components, "messages");
const schemas = property(components, "schemas");

function schema(name: string): JsonObject {
  return property(schemas, name);
}

function channel(name: string): JsonObject {
  return property(channels, name);
}

function operation(name: string): JsonObject {
  return property(operations, name);
}

function referencedMessage(refHolder: JsonObject): JsonObject {
  let value = refHolder;
  for (let depth = 0; depth < 3; depth += 1) {
    const ref = value.$ref;
    if (typeof ref !== "string") return value;
    value = asObject(resolveLocalRef(document, ref), ref);
  }
  throw new TypeError("message reference chain is too deep");
}

describe("AsyncAPI contract", () => {
  it("uses AsyncAPI 3.0 and defines SSE plus authenticated audio WebSocket channels", () => {
    expect(document.asyncapi).toBe("3.0.0");
    expect(document.defaultContentType).toBe("application/json");
    expect(channel("interviewEvents").address).toBe("/interviews/{interviewId}/events");
    expect(channel("interviewAudio").address).toBe("/ws/interviews/{interviewId}/audio");
    expect(property(property(document, "servers"), "localWebSocket").protocol).toBe("ws");

    expect(operation("receiveInterviewEvents").action).toBe("receive");
    expect(operation("sendAudioControl").action).toBe("send");
    expect(operation("sendAudioChunk").action).toBe("send");
    expect(operation("receiveAudioServerMessages").action).toBe("receive");
    for (const name of ["sendAudioControl", "sendAudioChunk", "receiveAudioServerMessages"]) {
      expect(property(operation(name), "channel").$ref).toBe("#/channels/interviewAudio");
      expect(operation(name).security).toEqual([{ sessionCookie: [] }]);
    }
  });

  it("contains no dangling local references", () => {
    const refs = collectLocalRefs(document);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(resolveLocalRef(document, ref), ref).toBeDefined();
  });

  it("keeps the SSE event enum synchronized with the exported runtime enum", () => {
    const expectedTypes = [...REALTIME_EVENT_TYPES];
    const eventChannelMessages = property(channel("interviewEvents"), "messages");
    const actualTypes = Object.values(eventChannelMessages).map((holder, index) =>
      String(referencedMessage(asObject(holder, `eventMessage[${index}]`)).name),
    );
    expect(actualTypes.sort()).toEqual([...expectedTypes].sort());
    expect(asStringArray(schema("EventType").enum, "EventType.enum").sort()).toEqual(
      [...expectedTypes].sort(),
    );
    expect(asObjectArray(operation("receiveInterviewEvents").messages, "SSE messages"))
      .toHaveLength(expectedTypes.length);

    for (const [messageKey, rawHolder] of Object.entries(eventChannelMessages)) {
      const message = referencedMessage(asObject(rawHolder, messageKey));
      const payloadRef = property(message, "payload").$ref;
      if (typeof payloadRef !== "string") throw new TypeError(`${messageKey}.payload.$ref is required`);
      const payload = asObject(resolveLocalRef(document, payloadRef), payloadRef);
      const specialization = asObjectArray(payload.allOf, `${messageKey}.allOf`)
        .find((entry) => "properties" in entry);
      if (!specialization) throw new TypeError(`${messageKey} specialization is required`);
      const eventProperties = property(specialization, "properties");
      expect(property(eventProperties, "type").const).toBe(message.name);
      expect(property(eventProperties, "data").$ref).toMatch(
        /^#\/components\/schemas\/[A-Za-z]+Data$/,
      );
    }
  });

  it("requires durable ordering, aggregate version, batch, and resync metadata", () => {
    const required = asStringArray(schema("RealtimeEventBase").required, "RealtimeEventBase.required");
    expect(required).toEqual(
      expect.arrayContaining([
        "schemaVersion",
        "eventId",
        "interviewId",
        "seq",
        "aggregateVersion",
        "snapshotType",
        "occurredAt",
        "type",
        "turnId",
        "batchIndex",
        "batchSize",
        "isBatchFinal",
        "snapshotUrl",
        "data",
      ]),
    );
    const properties = property(schema("RealtimeEventBase"), "properties");
    expect(property(properties, "schemaVersion").const).toBe(1);
    expect(property(properties, "eventId")).toMatchObject({
      $ref: "#/components/schemas/Identifier",
    });
    expect(property(properties, "seq")).toMatchObject({ type: "integer", minimum: 1 });
    expect(property(properties, "batchIndex")).toMatchObject({ type: "integer", minimum: 0 });
    expect(property(properties, "batchSize")).toMatchObject({ type: "integer", minimum: 1 });
    expect(property(properties, "isBatchFinal").type).toBe("boolean");
    expect(property(properties, "snapshotUrl").format).toBe("uri-reference");

    expect(property(operation("receiveInterviewEvents"), "x-sse")).toMatchObject({
      contentType: "text/event-stream",
      eventNameProperty: "type",
      eventIdProperty: "seq",
      orderingProperty: "seq",
      resumeRequestHeader: "Last-Event-ID",
      resumeSemantics: "exclusive",
      replayGapStatus: 409,
      replayGapErrorCode: "EVENT_REPLAY_GAP",
    });
  });

  it("matches preview/correction/completion event data emitted by the runtime", () => {
    const transcriptProcessingVariants = asObjectArray(
      property(property(schema("TranscriptFinalizedData"), "properties"), "processing").oneOf,
      "transcript processing variants",
    );
    expect(transcriptProcessingVariants).toHaveLength(3);
    expect(
      transcriptProcessingVariants.map((variant) =>
        property(property(variant, "properties"), "status").const
      ),
    ).toEqual([
      "APPLIED",
      "RETRYABLE_FAILURE",
      "NON_RETRYABLE_FAILURE",
    ]);
    for (const variant of transcriptProcessingVariants) {
      expect(property(property(variant, "properties"), "metadata").$ref).toBe(
        "#/components/schemas/TurnPlannerMetadata",
      );
    }
    expect(schema("TurnPlannerMetadata")).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    expect(asStringArray(schema("FeaturePreviewUpdatedData").required, "feature.required"))
      .toEqual(["features"]);
    expect(asStringArray(schema("SummaryPreviewUpdatedData").required, "summary.required"))
      .toEqual(["summary"]);
    expect(asStringArray(schema("TranscriptCorrectedData").required, "correction.required"))
      .toEqual([
        "correctionId",
        "segmentId",
        "revision",
        "rawText",
        "previousEffectiveText",
        "correctedText",
        "reason",
      ]);

    const completed = schema("InterviewCompletedEvent");
    const specialization = asObjectArray(completed.allOf, "InterviewCompletedEvent.allOf")
      .find((entry) => "properties" in entry);
    if (!specialization) throw new TypeError("InterviewCompletedEvent specialization is required");
    const eventProperties = property(specialization, "properties");
    expect(property(eventProperties, "snapshotType").const).toBe("FINAL");
    expect(property(eventProperties, "type").const).toBe("interview.completed");
    expect(asStringArray(schema("InterviewCompletedData").required, "completion.required"))
      .toEqual(["finalSnapshotId", "evaluationId", "completionStatus", "evaluationEligible"]);
    expect(property(property(schema("InterviewCompletedData"), "properties"), "evaluationId").type)
      .toEqual(["string", "null"]);
  });

  it("documents every runtime audio control and exact binary frame header", () => {
    expect(schema("AudioProtocolVersion").const).toBe(AUDIO_PROTOCOL_VERSION);
    expect(asStringArray(schema("AudioControlType").enum, "AudioControlType.enum"))
      .toEqual([...AUDIO_CONTROL_TYPES]);
    expect(asStringArray(schema("AudioControlMessage").required, "AudioControlMessage.required"))
      .toEqual([
        "protocolVersion",
        "type",
        "correlationId",
        "audioSessionId",
        "interviewId",
      ]);
    expect(schema("AudioControlMessage").allOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          if: expect.objectContaining({ properties: { type: { const: "audio.start" } } }),
          then: expect.objectContaining({ required: ["mimeType"] }),
        }),
      ]),
    );

    const header = {
      protocolVersion: AUDIO_PROTOCOL_VERSION,
      type: "audio.chunk" as const,
      audioSessionId: "audio-session-1",
      audioSeq: 1,
      clientMonotonicMs: 123.5,
      mimeType: "audio/webm;codecs=opus",
    };
    expect(() => assertAudioChunkHeader(header)).not.toThrow();
    expect(asStringArray(schema("AudioChunkHeader").required, "AudioChunkHeader.required"))
      .toEqual(Object.keys(header));
    const audio = new Uint8Array([1, 2, 3]);
    expect(decodeAudioFrame(encodeAudioFrame(header, audio))).toEqual({ header, audio });
    expect(schema("AudioBinaryFrame")).toMatchObject({
      type: "string",
      format: "binary",
      contentMediaType: "application/octet-stream",
    });
    expect(property(componentMessages, "AudioChunk").contentType).toBe("application/octet-stream");
  });

  it("documents ACK, VAD, partial/final STT, and error server messages", () => {
    const expectedServerTypes = [
      "audio.ack",
      "vad.speech_started",
      "vad.speech_stopped",
      "stt.partial",
      "stt.recognized",
      "stt.final",
      "audio.error",
    ];
    const receiveRefs = asObjectArray(
      operation("receiveAudioServerMessages").messages,
      "receiveAudioServerMessages.messages",
    );
    const actualTypes = receiveRefs.map((holder) =>
      String(referencedMessage(holder).name),
    );
    expect(actualTypes).toEqual(expectedServerTypes);

    for (const schemaName of [
      "AudioAckMessage",
      "VadSpeechStartedMessage",
      "VadSpeechStoppedMessage",
      "SttPartialMessage",
      "SttRecognizedMessage",
      "SttFinalMessage",
      "AudioErrorMessage",
    ]) {
      expect(asStringArray(schema(schemaName).required, `${schemaName}.required`))
        .toContain("protocolVersion");
    }
    expect(asStringArray(schema("SttPartialMessage").required, "partial.required"))
      .toEqual(expect.arrayContaining(["text", "provider", "serverTime"]));
    expect(asStringArray(schema("SttRecognizedMessage").required, "recognized.required"))
      .toEqual(expect.arrayContaining(["text", "provider", "serverTime"]));
    expect(asStringArray(schema("SttFinalMessage").required, "final.required"))
      .toEqual(expect.arrayContaining([
        "text",
        "provider",
        "serverTime",
        "processingStatus",
        "processingCode",
      ]));
    expect(asStringArray(schema("AudioErrorMessage").required, "error.required"))
      .toEqual(expect.arrayContaining(["code", "message", "retryable"]));
  });
});
