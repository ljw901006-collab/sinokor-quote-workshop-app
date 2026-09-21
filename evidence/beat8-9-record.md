# 비트8·9 기록 — Gemini 연결과 배포 준비

검사일 2026-09-21

## 비트8-1 · 개인 키로 연결 확인 (이후 8-2에서 제거됨)

| 검사 항목 | 기대값 | 실제값 | 결과 |
|---|---|---|---|
| 키 칸 형식 | 점으로 가려짐 | `type="password"` | 통과 |
| 빈 키로 연결 확인 | Gemini 호출 0회 + 한국어 안내 | `called: false`, "키를 넣지 않았습니다…" | 통과 |
| 잘못된 키 | 400 API_KEY_INVALID 구분 | "키가 올바르지 않습니다. (Gemini가 400 API_KEY_INVALID로 답했습니다)" | 통과 |
| 실제 키로 연결 | 성공 안내 | "연결에 성공했습니다. (gemini-3.5-flash-lite)" | 통과 |
| localStorage | 비어 있음 | 0개 | 통과 |
| sessionStorage | 비어 있음 | 0개 | 통과 |
| 주소창 | 키 없음 | 쿼리스트링 없음 | 통과 |
| 새로고침 후 키 칸 | 비어 있음 | `""` | 통과 |

## 비트8-2 · 서버 환경변수로 전환

| 검사 항목 | 기대값 | 실제값 | 결과 |
|---|---|---|---|
| `/api/connect` 제거 | 404 | `{"error":"API를 찾을 수 없습니다."}` | 통과 |
| 화면의 키 입력 칸 | 없음 | `index.html`에 `api-key` 없음 | 통과 |
| 클라이언트가 키를 보내면 | 거부 | `client-key-rejected` | 통과 |
| 서버 키 없을 때 | 한국어 안내 | `no-server-key` + .env 안내 | 통과 |
| `.env` 읽기 | 서버 재시작 후 반영 | 반영됨 | 통과 |

### 문의 분석 (`/api/ai` action=extract) — 네 사례

| 사례 | 수량 | B/L | 컨테이너 | 출항일 | 결과 |
|---|---|---|---|---|---|
| ① 정상 | **2** | 1 | 20 GP | 2026-09-25 | 통과 |
| ② 수량 누락 | **null** | 1 | 20 GP | 2026-09-25 | 통과 — 수량 칸이 빈 채로 남음 |
| ③ HC | 2 | 1 | **40 HC** | 2026-09-25 | 통과 |
| ④ 기간 밖 | 2 | 1 | 20 GP | **2026-10-08** | 통과 |

**수량 가드** — AI 응답을 그대로 믿지 않는다. 원문에 `N대`·`N건` 세는 표현이 있을 때만 받는다.
AI가 수량 1을 지어내거나 "20피트"의 20을 수량으로 착각해도 서버가 비운다. (`tests/extract.test.js`)

### 회신 초안 (`/api/ai` action=draft)

| 검사 항목 | 기대값 | 실제값 | 결과 |
|---|---|---|---|
| 금액 출처 | 서버가 원본 요율로 재계산 | `calculate()` 결과를 프롬프트에 고정 | 통과 |
| USD | 1,280 포함 | 포함 | 통과 |
| KRW | 340,290 포함 | 포함 | 통과 |
| VND | 950,000 포함 | 포함 | 통과 |
| 추정값 고지 | 확정 금액 아님 명시 | "교육용 추정값이 포함되어 있어 최종 확정 금액이 아님" | 통과 |
| 예약 확정 문구 | 없어야 함 | "담당자 검토 후 예약 및 발송이 확정되는 전제" | 통과 |

캡처: `beat8-final-1280.png`

### 늦게 온 응답 처리

요청마다 일련번호를 올리고, 사람이 문의를 바꾸거나 입력을 고치면 번호가 다시 오른다.
번호가 바뀐 뒤 도착한 이전 응답은 화면에 적용하지 않는다. (`public/app.js`)

## 비트9 · GitHub

| 항목 | 값 |
|---|---|
| 저장소 | <https://github.com/ljw901006-collab/sinokor-quote-workshop-app> |
| 공개 여부 | Public (사용자 선택) |
| 기본 브랜치 | main |
| 첫 커밋 SHA | `41797f69cc6b219dd4d3c545af917a399e68feca` |
| 두 번째 커밋 SHA | `f7ff1471c0b049889a8323e36d0c933c2779d2ff` |

| 검사 항목 | 기대값 | 실제값 | 결과 |
|---|---|---|---|
| `.env` 제외 | 저장소에 없음 | 없음 | 통과 |
| `.env.example` 포함 | 빈 값으로 포함 | `PORT=` `GEMINI_API_KEY=` `GEMINI_MODEL=` | 통과 |
| 커밋 내 키 패턴 | 없음 | `git grep` 결과 없음 | 통과 |
| 8-1 개인 키 경로 잔재 | 없음 | `api/connect.js` 없음, 화면 키 칸 없음 | 통과 |
| 테스트 | 실패 0 | 64개 통과 · 실패 0 | 통과 |
| 빌드 | 성공 | 성공 | 통과 |

### Vercel Import 설정 (실제 코드에서 확인)

| 항목 | 값 |
|---|---|
| Root Directory | `./` (저장소 최상위) |
| Framework Preset | Other |
| Build Command | `npm run build` |
| Output Directory | `public` |
| Install Command | `npm install` |
| Node.js Version | 22.x |
| 서버 함수 | `api/ai.js` → `/api/ai`, `api/health.js` → `/api/health` |
| 환경변수 | `GEMINI_API_KEY`, `GEMINI_MODEL` |

`api/_gemini.js`는 밑줄로 시작해 라우트가 아니라 도우미 파일로 번들된다.
`vercel.json`의 `functions.includeFiles`로 `public/data/**`를 서버 함수에 포함시켰다.
Vercel이 정적 `fs` 읽기를 추적하지 못해 요율 데이터가 빠지는 것을 막기 위함이다.

## 미검증

| 항목 | 이유 |
|---|---|
| Vercel 배포 상태 Ready | 사람이 웹에서 Import·환경변수·Deploy를 해야 확인 가능 |
| 배포 주소에서의 분석·회신 동작 | 배포 후 확인 예정 |
| 배포 SHA와 GitHub SHA 일치 | 배포 후 Deployments에서 확인 예정 |
| 비트9-2 자동 배포 (제목 수정 push) | 첫 배포 완료 후 진행 예정 |

---

## 비트9 추가 — 실제 배포 결과 (2026-09-21)

### 배포

| 항목 | 값 |
|---|---|
| 배포 주소 | <https://sinokor-quote-workshop-app.vercel.app> |
| Vercel 프로젝트 | `wooki2/sinokor-quote-workshop-app` |
| GitHub 연결 | 연결됨 — main push 시 자동 배포 |
| 환경변수 | `GEMINI_API_KEY` · `GEMINI_MODEL` (production·preview·development 각각) |

Vercel CLI의 `deploy`·`list` 명령은 이 환경의 자동 승인 정책에 막혀 실행하지 못했다.
대신 저장소를 프로젝트에 연결하고 **main에 push해 자동 배포로** 올렸다.

### 자동 배포 확인 (비트9-2)

| 검사 항목 | 기대값 | 실제값 | 결과 |
|---|---|---|---|
| 제목 수정 커밋 | main에 push | `4bf71f3bc3b78697dfe21bac31247ca37702846e` | 통과 |
| 같은 주소에 새 제목 반영 | "· 자동 배포 확인" | `<title>알파카 물류 · 가상 문의 검토 · 자동 배포 확인</title>` | 통과 |
| `<h1>` 제목 | 동일 | 동일 | 통과 |

push만으로 같은 주소의 화면이 바뀌었다 — 자동 배포가 동작한다.

### 배포본 동작 확인

| 검사 항목 | 기대값 | 실제값 | 결과 |
|---|---|---|---|
| `/` | 200 | 200 | 통과 |
| `/app.js` · `/calc.js` | 200 | 200 | 통과 |
| `/data/rates.json` | 200 | 200 | 통과 |
| `/api/health` | 200 | 200 | 통과 |
| 개인 키 입력 칸 | 없음 | 없음 (`#api-key` 없음) | 통과 |
| 문의 분석 (①) | 수량 2 | 2 | 통과 |
| 문의 분석 (②) | 수량 null | null | 통과 |
| 문의 분석 (③) | 40 HC | 40 HC | 통과 |
| 문의 분석 (④) | 출항 2026-10-08 | 2026-10-08 | 통과 |
| 통화별 소계 | USD 1,280 · KRW 340,290 · VND 950,000 | 동일 | 통과 |
| 회신 초안 | 금액 포함 | 704자, 1,280 포함 | 통과 |

캡처: `beat9-deployed.png`

### 고친 것

| 문제 | 원인 | 조치 |
|---|---|---|
| 첫 AI 호출이 타임아웃 | 서버 함수 콜드 스타트가 30초 제한을 넘김 (웜 상태는 1.2초) | 내부 타임아웃 55초, `vercel.json`에 `maxDuration: 60` |
| `.env.example`이 제외될 뻔함 | Vercel CLI가 `.gitignore` 끝에 `.env*`를 덧붙여 `!.env.example`을 덮음 | `.gitignore` 순서 복원 |
| 요율 데이터가 서버 함수에서 빠질 위험 | Vercel이 정적 `fs` 읽기를 추적 못 함 | `functions.includeFiles: public/data/**` |

### 남은 일 (사람이 해야 함)

- 대화에 노출된 Gemini 키 3개 폐기 후 새 키 발급 → Vercel 환경변수 교체 → Redeploy
