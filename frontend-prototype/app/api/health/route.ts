export async function GET() {
  return Response.json({
    status: "ok",
    service: "donghaeng-finance",
    source: "frontend-prototype",
  });
}
