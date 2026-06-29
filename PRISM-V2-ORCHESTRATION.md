# Prism v2 Global Platform - Full Orchestration Plan

**Status**: ACTIVE ORCHESTRATION  
**Date**: February 17, 2026  
**Scope**: FNB fixes + Global statement extraction platform  
**Timeline**: 2-3 weeks to MVP, then iterative expansion  

---

## 🎯 Strategic Objectives

### Immediate (This Week)
✅ Fix FNB extraction (02 Feb file should output clean data)  
✅ Build bank detection registry  
✅ Implement universal normalization  

### Short-term (Next Week)
✅ User correction UI  
✅ Quality scoring system  
✅ Comprehensive testing  

### Medium-term (2-3 Weeks)
✅ Add 10-15 more banks  
✅ Multilingual support (EN, AF, ES, FR, PT, DE)  
✅ Launch Prism v2.0  

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                   PRISM v2 PLATFORM                     │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  INPUT: PDF Statement (any bank, any language)          │
│    ↓                                                    │
│  [1] Bank Detection Registry                            │
│    ├─ FNB (SA)      [PRIORITY]                         │
│    ├─ ABSA (SA)                                        │
│    ├─ Nedbank (SA)                                     │
│    ├─ ICICI (IN)                                       │
│    └─ ... 50+ banks                                    │
│    ↓                                                    │
│  [2] Extraction Strategy                                │
│    ├─ Text extraction (pdf.js)                         │
│    ├─ OCR fallback (Tesseract)                         │
│    └─ AI-assisted (Groq)                               │
│    ↓                                                    │
│  [3] Multilingual Parsing                               │
│    ├─ Date: "06 Jan" / "6 January" / "6/1"            │
│    ├─ Currency: R / $ / € / £                          │
│    └─ Languages: EN / AF / ES / FR / PT / DE           │
│    ↓                                                    │
│  [4] Universal Normalization                            │
│    └─ CanonicalTransaction schema                      │
│    ↓                                                    │
│  [5] Validation & Quality Scoring                      │
│    ├─ Balance reconciliation                           │
│    ├─ Data completeness                                │
│    └─ Confidence score (0-100)                         │
│    ↓                                                    │
│  [6] User Correction (if confidence < 85%)             │
│    └─ Review UI with ability to fix amounts            │
│    ↓                                                    │
│  OUTPUT: Excel with audit trail                         │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## 📋 Master Task Breakdown

### PHASE 1: Foundation (3-4 days)

#### Group A: Core Services (Parallel)

**A1: Bank Registry & Detection** (Backend Specialist)
- [ ] Create `bankRegistry.ts` with 20+ bank patterns
- [ ] Implement FNB detection (priority)
- [ ] Add ABSA, Nedbank, ICICI, Standard Bank
- [ ] Test detection against real statements

**A2: Normalization Pipeline** (Backend Specialist)
- [ ] Create `normalizer.ts` (universal schema)
- [ ] Implement `dateParser.ts` (multilingual)
- [ ] Implement `currencyParser.ts` (multi-currency)
- [ ] Create `transactionNormalizer.ts`

**A3: Quality & Validation** (Backend Specialist)
- [ ] Create `qualityScore.ts` (confidence 0-100)
- [ ] Implement `reconciliationValidator.ts`
- [ ] Add anomaly detection

#### Group B: FNB Fixes (Parallel)

**B1: FNB Header/Footer Handling** (Backend Specialist)
- [ ] Add footer pattern detection
- [ ] Implement header deduplication
- [ ] Fix "Delivery Method..." footer bleeding
- [ ] Extract opening/closing from header

**B2: Column Merging** (Backend Specialist)
- [ ] Merge Amount/Amount2/Amount3 → unified Amount
- [ ] Fix Cr/Dr suffix normalization
- [ ] Handle fragmented row data

**B3: FNB Testing** (Test Engineer)
- [ ] Write tests for 02 Feb file
- [ ] Test all edge cases (missing fees, wrapped text)
- [ ] Validate output matches expected structure

#### Group C: Testing Foundation (Parallel)

**C1: Test Infrastructure** (Test Engineer)
- [ ] Set up integration tests for each service
- [ ] Create test data fixtures
- [ ] Mock extraction scenarios

---

### PHASE 2: User Experience (2-3 days)

**D1: Correction UI** (Frontend Specialist)
- [ ] Build transaction review component
- [ ] Display quality scores
- [ ] Allow inline corrections
- [ ] Audit trail tracking

**D2: Quality Display** (Frontend Specialist)
- [ ] Show extraction confidence
- [ ] Explain issues/warnings
- [ ] Display data source (text/OCR/AI)

**D3: Excel Enhancement** (Backend Specialist)
- [ ] Add Summary sheet with quality metrics
- [ ] Add RawLines sheet for transparency
- [ ] Add audit trail column

---

### PHASE 3: Testing & Validation (2-3 days)

**E1: Comprehensive Testing** (Test Engineer)
- [ ] Unit tests for all services
- [ ] Integration tests for full pipeline
- [ ] E2E tests for multiple banks
- [ ] Coverage target: 85%+

**E2: Real-World Testing** (QA Automation Engineer)
- [ ] Test with 02 Feb FNB file
- [ ] Test with other bank formats
- [ ] Cross-browser testing
- [ ] Performance testing

---

### PHASE 4: Expansion (3-5 days, Iterative)

**F1: Add More Banks** (Backend Specialist)
- [ ] Add 5-10 more banks to registry
- [ ] Test each bank format
- [ ] Document bank patterns

**F2: Multilingual Support** (Backend Specialist)
- [ ] Add Afrikaans date parsing
- [ ] Add Spanish month names
- [ ] Add French month names
- [ ] Test with real statements in each language

**F3: Documentation** (Documentation Writer)
- [ ] API documentation
- [ ] Bank registry guide
- [ ] User guide for corrections
- [ ] Developer guide for adding banks

---

## 🎯 Agent Assignments

| Agent | Role | Phase | Tasks |
|-------|------|-------|-------|
| **orchestrator** | Director | All | Coordinate all agents, resolve conflicts |
| **backend-specialist** | Core dev | 1-4 | Services, FNB fixes, normalization, bank registry |
| **frontend-specialist** | UI dev | 2 | Correction UI, quality display, styling |
| **test-engineer** | QA | 1-3 | Unit tests, integration tests, TDD |
| **qa-automation-engineer** | E2E QA | 3 | Real-world testing, Playwright tests |
| **database-architect** | Schema | 1 | If needed for caching extracted data |
| **devops-engineer** | Deployment | 4 | CI/CD, deployment pipeline, monitoring |
| **documentation-writer** | Docs | 4 | API docs, user guides, bank registry guide |
| **explorer-agent** | Analysis | 1 | Architecture review, dependency analysis |
| **performance-optimizer** | Speed | 3-4 | Profile extraction, optimize bottlenecks |

---

## 📊 Success Metrics

| Metric | Target | Owner |
|--------|--------|-------|
| FNB extraction success rate | >99% | Backend + Test Engineer |
| No "Amount 2/3" columns | 100% clean | Backend |
| No footer text in rows | 100% clean | Backend |
| User correction needed | <5% of documents | Backend + Frontend |
| Average quality score | >85/100 | Backend |
| Balance reconciliation rate | >95% | Backend |
| Test coverage | 85%+ | Test Engineer |
| Supported banks | 20+ by v2.0 | Backend |
| Supported languages | 6+ by v2.0 | Backend |
| Extraction time | <30 sec/doc | Performance Optimizer |

---

## 🚀 Execution Order

**Week 1 (This week)**
- Days 1-2: Phase 1A + 1B (Parallel)
  - Backend: Bank registry, normalizer
  - Backend: FNB fixes
  - Test: Test infrastructure
  
- Days 3-4: Phase 1C + Phase 2A (Parallel)
  - Test: Comprehensive testing
  - Frontend: Correction UI

**Week 2**
- Days 1-2: Phase 2B-D + Phase 3A
  - Frontend: Quality display + Excel
  - Test: Integration & E2E tests
  
- Days 3-5: Phase 3B + Phase 4A
  - QA: Real-world testing
  - Backend: Add more banks

**Week 3 (Optional, Iterative)**
- Phase 4B-C: Multilingual support, documentation

---

## 🔄 Handoff Protocol

### Backend → Frontend
- Backend delivers: normalized transaction schema, API endpoints
- Frontend builds: correction UI using the schema

### Backend → Test
- Backend delivers: functions to test
- Test builds: test suite with 85%+ coverage

### Test → QA
- Test delivers: unit tests passing
- QA builds: E2E tests, real-world validation

### All → DevOps
- Team delivers: tested, documented code
- DevOps deploys: CI/CD, monitoring

---

## 🎯 Phase 1A: Immediate Actions

### For Backend Specialist
```
1. CREATE: services/bankRegistry.ts
   - Add FNB, ABSA, Nedbank, ICICI patterns
   - Implement detectBank() function
   
2. CREATE: services/normalizer.ts
   - Implement normalizeRow() → CanonicalTransaction
   
3. CREATE: services/dateParser.ts
   - parseDate() supporting "06 Jan", "6/1", EN/AF/ES/FR
   
4. CREATE: services/currencyParser.ts
   - parseAmount() handling R, $, €, £
   
5. MODIFY: services/fnbExtractService.ts
   - Add FNB_FOOTER_PATTERNS
   - Fix column merging
   - Extract metadata from header

6. MODIFY: services/tableExtractor.ts
   - Add footer filtering
   - Header deduplication
```

### For Test Engineer
```
1. CREATE: tests/bankRegistry.test.ts
2. CREATE: tests/normalizer.test.ts
3. CREATE: tests/dateParser.test.ts
4. CREATE: tests/currencyParser.test.ts
5. SETUP: Test fixtures (02 Feb file, other bank samples)
```

### For Frontend Specialist
```
(Wait for backend Phase 1A completion)
```

---

## 📞 Communication

**Daily Check-ins**: 9 AM (5 mins)
- What's done?
- What's blocked?
- Do we need to adjust?

**Daily Handoffs**: 5 PM
- Backend → Test (completed functions)
- Test → Frontend (test suite)
- Frontend → Backend (UI feedback)

---

## ⚠️ Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Bank patterns wrong | Test with real statements, add to registry iteratively |
| Date parsing ambiguous | Support multiple formats, user can correct |
| Extraction too slow | Profile early, optimize parsing |
| User overwhelmed by corrections | Only show UI if confidence < 85% |
| Multilingual complexity | Start EN+AF only, expand iteratively |

---

## 🏁 Definition of Done

✅ Phase 1: 02 Feb FNB file exports perfectly + all tests pass
✅ Phase 2: User can correct any misextractions
✅ Phase 3: 85%+ test coverage + E2E validation
✅ Phase 4: Documentation complete, ready for beta users

---

## Next Steps (Immediate)

1. **Backend Specialist starts**: Create bankRegistry.ts + normalizer.ts
2. **Test Engineer starts**: Set up test infrastructure
3. **Frontend Specialist waits**: But review architecture for feedback
4. **Orchestrator monitors**: Daily stand-ups, unblock any issues
5. **Others on standby**: Ready to jump in as phases progress

---

**STATUS**: Ready to begin Phase 1A 🚀

Who's taking the first task?

