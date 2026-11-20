// Moves every saved reference to a tracker application when an edit changes its row key
// (sha1 of date|company|role|link). References that already carry a Record ID keep resolving through
// it; this rewrites the rest so nothing is orphaned, and records the new key everywhere.
import { rekeyActionReferences } from "./actions";
import { rekeyFoundLink } from "./foundLinkStore";
import { rekeyOpportunities } from "./opportunities";
import { reconcileRecruiting, rekeyRecruitingReferences } from "./recruiting";

export async function rekeyApplicationReferences(
  oldKey: string,
  newKey: string,
  recordId: string,
) {
  await rekeyActionReferences(oldKey, newKey, recordId);
  await rekeyRecruitingReferences(oldKey, newKey, recordId);
  rekeyFoundLink(oldKey, recordId);
  rekeyOpportunities(oldKey, newKey, recordId);
  await reconcileRecruiting();
}
