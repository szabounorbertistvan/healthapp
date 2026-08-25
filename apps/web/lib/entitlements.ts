// Moved to @buddygym/shared so mobile, web and edge functions read one table of
// entitlements (plan §2). Re-exported here to keep the existing "@/lib/..."
// import sites working.
export {
  ENTITLEMENTS,
  TIER_LABEL,
  entitlementsFor,
  type Entitlements,
  type Role,
  type Tier,
} from "@buddygym/shared";
