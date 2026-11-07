# Illustration coverage matrix

This is the explanation contract for the expanded ten-slide presentation. The main story uses the implemented design; no illustration adds a runtime component to the app. Review dates remain in source records, not the artwork.

| User requirement | Primary slide | Boundary preserved |
| --- | --- | --- |
| Show frontend and backend responsibilities instead of a single FastAPI box | Application components (`01b`) | One frontend app and one modular FastAPI backend; scoped parent, child and operator identities |
| Initial research-based goal/habit database creation | AI pipeline 1 of 2: research/catalog (`04`) | Initial offline versioned catalog publication; no bulk family-goal import or preassigned child habits |
| Research, age fit, guidance and exclusions | Research/catalog (`04`), safety (`07`), evaluations (`06`) | Evidence-informed practice, not proven effectiveness of every generated action |
| RAG, embeddings and vector database | Both AI slides (`04`, `02b`) | Prepared card text and query embeddings, Pinecone search, authoritative canonical hydration |
| Retrieval and generation | AI runtime (`02b`) | Retrieval before the graph; reviewed selected goals saved; separate habit batches |
| LangChain and LangGraph | Components (`01b`), runtime (`02b`), safety (`07`) | LangChain typed/provider calls; LangGraph orchestrates the Coach's five nodes |
| Habit Coach, Planner and Review as distinct roles | AI runtime (`02b`) | Planner and Review are independent one-call helpers outside Coach, not invented supervisor-graph agents |
| Preserve the earlier detailed runtime view | Detailed Coach (`02`) | Original image unchanged and returned to the main presentation; offline catalog creation remains a separate slide |
| Equal prominence for Planner and Review | Dedicated Planner (`08`) and Weekly Review (`09`) | Each gets a full-size view with its own trigger, facts, structured call, local checks and parent decision |
| Masking, layered safeguards and grounded generation | Safety (`07`) | Code checks, model prose review, human decisions and transactional enforcement are different mechanisms |
| End-to-end usage/cost/latency monitoring | Tokenomics (`05`) | Attempt usage includes chat, embedding and search; missing usage is unknown, dollars are estimates |
| Credits, demo mode and enforcement | Tokenomics (`05`) | Useful-result tariffs versus provider cost; one enforce toggle; verified tariffs and bounds required |
| Catalog, embedding, model and safety evaluation history | Evaluations (`06`) | Source audits, synthetic model study, mocked control-flow tests and bounded live samples stay distinct |
| Final AWS deployment | AWS (`03`) | Two ALBs, public-subnet Fargate with restricted inbound access, private RDS, backend-only startup secrets |
| No implementation dates | All primary illustrations | Dates kept only in provenance documents |

The original system overview remains supplemental. The original detailed AI pipeline is preserved unchanged and now appears as main slide 4; Planner and Review follow as slides 5 and 6. All other earlier illustrations remain. Exact case counts, provider IDs, limits, source links and omitted details are in the adjacent content contracts.
