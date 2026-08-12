import type { RequiredInformationItem } from "./interview";
import { createDevV1RequiredInformationItems } from "./information-catalog";

/**
 * The server-owned baseline interview contract. It contains no borrower facts,
 * prefills, scripts, or assumed industry signals.
 */
export function createDefaultRequiredInformationItems(): RequiredInformationItem[] {
  return createDevV1RequiredInformationItems();
}
