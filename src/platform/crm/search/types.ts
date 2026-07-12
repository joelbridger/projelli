export type CrmSearchHit = {
  entityId: string;
  entityKind: string;
  matterId: string;
  title: string;
  snippet: string;
  /** The local, decrypted record returned only after a person searches. */
  content: string;
};

export type CrmSearchScope = {
  id: string;
  label: string;
};
