# 알파카 물류 · 가상 문의 검토 앱

부산(KRPUS) → 하이퐁(VNHPH) 운임 문의를 정리하고 견적·회신 초안을 검토하는 수업용 앱.
문의·요율·이름은 모두 교육용 가상 데이터다. 실제 발송·예약·견적 확정은 하지 않는다.

## 요구 환경

- Node.js **22 이상** (`node --version`으로 확인)
- npm

## 실행법

```bash
npm install     # 외부 의존성은 없지만 스크립트 사용을 위해 한 번 실행
npm run build   # 배포 전 필수 파일·데이터 검사
npm run dev     # 로컬 서버 실행
npm test        # 계산 규칙 자동 테스트
```

`npm run dev`를 실행하면 터미널에 열 주소가 표시된다. 기본은 <http://localhost:3000> 이고,
`.env`의 `PORT` 값으로 바꿀 수 있다.

## 환경변수

`.env.example`을 `.env`로 복사한 뒤 값을 채운다. `.env`는 GitHub에 올리지 않는다.

| 이름 | 설명 |
|---|---|
| `PORT` | 로컬 서버 포트 (비우면 3000) |
| `GEMINI_API_KEY` | 서버가 Gemini를 호출할 때 쓰는 키 (비트8) |
| `GEMINI_MODEL` | 사용할 Gemini 모델 이름 (비우면 기본값) |

## 폴더 구조

```
public/          정적 파일 — Vercel이 그대로 호스팅
  index.html
  styles.css
  app.js
  data/          화면이 읽는 문의·요율·출처 데이터
api/             서버 함수 — Vercel 서버리스 함수로 배포
server.js        로컬 개발 서버 (public 서빙 + api 라우팅)
scripts/build.js 배포 전 검사
tests/           자동 테스트
data/            원본 데이터 (public/data로 복사해 사용)
references/      Clay 디자인 참고 자료
```

## 데이터 출처

`data/sources.json`에 각 요율의 출처와 확인일이 적혀 있다.
`provenance`가 `public`이면 공개 확인값, `estimate`면 교육용 추정값이다.
교육용 추정값은 실제 시세나 선사 요율이 아니다.
