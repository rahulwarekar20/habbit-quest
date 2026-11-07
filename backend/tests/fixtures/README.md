# Provider response fixtures

`pinecone_documents_search.json` captures the public card metadata from a read-only Pinecone Documents search on 2026-11-04, using an already stored catalog vector from the pinned `0.1.0` release. No new embedding or model call was used. Query vectors, credentials, host, namespace usage metadata and user/family data are omitted.

The service returns `age_min`, `age_max` and `embedding_dimensions` as JSON floating-point values (`6.0`, `8.0`, `512.0`), although canonical catalog records use integers. The adapter accepts the identical finite integral value while rejecting booleans, numeric strings, fractions, nonfinite values and mismatched identity/hash/release fields.
