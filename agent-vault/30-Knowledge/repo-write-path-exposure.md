---
project: StockInvest
created: 2026-08-09
tags:
  - type/knowledge
  - type/incident
  - domain/security
  - domain/infra
aliases:
  - 출처불명 커밋 1ca95dc
  - 저장소 쓰기경로 노출
related_tasks:
  - "[[T-012-zero-price-snapshot]]"
---

# 🔴 출처를 특정하지 못한 커밋 `1ca95dc` — 저장소 쓰기경로가 열려 있다

## 무슨 일이 있었나

2026-08-09 **18:06:16**, 커밋 `1ca95dc`("feat: implement migration T-012 to clean up zero-priced snapshots", 19파일 +2337/−51)가 생성되고 **18:06:25** 웹훅으로 자동 배포됐다. 배포와 함께 운영 DB 에서 스냅샷 **12행이 삭제**됐다.

**Leader·사용자 모두 이 커밋을 하지 않았다.** 내용 자체는 사용자가 당일 이미 승인한 범위(12행 삭제)였고 결과물도 독립 검증에서 안전이 확인돼 롤백은 하지 않기로 판단했다. 그러나 **경로가 특정되지 않았다.**

## 확인된 사실

| 항목 | 결과 |
|---|---|
| author / committer | `brownjeon <ifries8611@gmail.com>` — 이 호스트 git 기본값, 식별력 없음 |
| GPG 서명 | 없음(`%G? = N`) |
| 커밋 메시지 형식 | **영문 불릿** — 이 저장소의 다른 모든 커밋(한글)과 형식이 다름 |
| `.git/COMMIT_EDITMSG` | 18:06 기록됨 → **이 워킹트리의 `.git` 에 대해 `git commit` 이 실행됨** |
| Claude 세션 트랜스크립트 | **17:38:39 ~ 20:46:21 사이 이 호스트에 활동 세션 없음** — 커밋 시각이 공백 한가운데 |
| 사용자 crontab | git commit/push 자동화 없음 |
| webhook-deploy(`~/.local/webhook-deploy/server.js`) | commit/push 구문 미발견 (pull·배포 전용으로 보임) |

## 가장 유력한 가설 — NFS 공유 경유

저장소는 로컬 디스크가 아니라 **NFS 마운트**다:

```
192.168.219.154:/volume1/homes  →  /home/brownjeon/NFS/homes
type nfs (rw, vers=3, sec=sys)
```

`sec=sys` 는 **클라이언트가 주장하는 UID 를 그대로 신뢰**한다. 따라서 같은 LAN 에서 이 공유를 마운트하고 UID 를 맞춘 **다른 호스트라면 이 저장소에 그대로 커밋할 수 있다** — 그리고 그 호스트에서 실행된 도구의 로그·트랜스크립트는 이 호스트의 `~/.claude` 가 아니라 **그 호스트에 남는다**. 이 호스트에서 세션 기록이 안 보이는 것과 모순되지 않는다.

과거 `last` 기록에 `192.168.219.123`(별도 작업 PC) 로그인 이력이 있으나 조사 시점에는 무응답이었다.

## 🔴 함께 발견된 상시 노출 — 푸시 토큰

```
.git/config   perms=-rw-rw-r--   (world-readable)
remote origin = http://<토큰>@192.168.219.154:3000/brownjeon/project_StockInvest.git
```

**remote URL 에 Gitea 푸시 토큰이 평문으로 박혀 있고, 그 파일이 NFS 공유 위에서 모두에게 읽기 가능하다.** 즉 이 공유를 읽을 수 있는 누구든 토큰을 얻어 푸시할 수 있다. `~/.git-credentials`(mode 600, `store` helper)도 18:07 에 갱신됐다.

이것은 이번 커밋의 원인으로 **입증된** 것은 아니지만, 원인과 무관하게 **지금 열려 있는 구멍**이다.

## 노출 범위 — 한 저장소 문제가 아니었다

토큰 값을 **해시로만** 비교한 결과(값 미출력), 같은 토큰이 여러 저장소에 흩어져 있었다:

| 저장소 | 토큰 해시 |
|---|---|
| TradingInvest · bjj-trainning · home-m4-api | `321cc75f…` (**공유**) |
| TheRoute | `a843c337…` (별개) |
| `~/.git-credentials` | `321cc75f…` |

즉 **StockInvest 만 고치는 것은 무의미했다** — 옆 프로젝트의 world-readable `.git/config` 를 읽으면 StockInvest 에 push 할 수 있는 동일 토큰이 그대로 나왔다. 노출 범위는 "이 저장소"가 아니라 **"공유 스토리지 위의 모든 저장소 중 가장 약한 하나"** 로 계산해야 한다.

## 조치 완료 (2026-08-09)

**핵심 발견: URL 의 토큰은 애초에 중복이었다.** 전역 `credential.helper=store` 가 이미 설정돼 있고 `~/.git-credentials` 는 **로컬디스크(`/dev/nvme0n1p2`), mode 600, NFS 아님**이다. 따라서 새 토큰을 URL 에 다시 넣을 필요 없이 **URL 에서 제거하기만 하면** 자격증명은 로컬디스크에서만 공급된다.

> 함정: `~/.git-credentials` 를 `192.168.219.154:3000` 으로 grep 하면 0건이 나온다 — 실제로는 **`192.168.219.154%3a3000`** 으로 URL 인코딩돼 저장된다. 이걸 놓치면 "자격증명이 없는데 왜 되지?" 로 잘못 판단하게 된다.

5개 저장소 전부 URL 토큰 제거 + `.git/config` `600` 적용, 각각 `git ls-remote` 로 인증 정상 확인(실패 시 자동 원복하도록 처리했으나 원복 발생 없음). NFS 공유상 `.git/config` 에 평문 토큰 **0건**.

## 남은 조치

1. **옛 토큰 폐기 — 사용자만 가능.** 이 토큰 스코프는 `write:repository` 뿐이라 토큰 관리 API 가 403 이고, Gitea 는 설계상 토큰으로 토큰을 관리할 수 없다(비밀번호 basic auth 필요). Gitea 웹 UI 에서 직접 폐기해야 한다. **순서 주의**: 새 토큰 발급 → `~/.git-credentials` 갱신 → 배포 1회 성공 확인 → **그 다음에** 옛 토큰 폐기. 먼저 폐기하면 5개 프로젝트 배포가 동시에 깨진다.
2. **TheRoute 고유 토큰 `a843c337…` 은 이제 미사용**(공유 토큰으로 인증됨) — 함께 폐기 대상.
3. **push 원 IP 미확인.** Gitea 활동 피드 API 에는 IP 필드 자체가 없다(반환 키: `act_user, act_user_id, comment, comment_id, content, created, id, is_private, op_type, ref_name, repo, repo_id, user_id`). 서버 로그에만 남으며 NAS SSH 는 `Permission denied`. Synology 에서 Gitea 컨테이너 로그의 `18:06:22` 전후 `git-receive-pack` 요청을 봐야 한다.
4. NFS 공유의 `sec=sys` 재검토(가능하면 Kerberos, 최소한 export 대상 호스트 제한).

> **계정명은 행위자를 특정해주지 않는다.** push 가 `brownjeon` 으로 기록된 것은 당연하다 — 노출된 토큰이 그 계정 소유이므로, 토큰을 주운 누구든 `brownjeon` 으로 기록된다.

## 교훈

- **"내가 안 했다"가 곧 "아무도 안 했다"가 아니다.** 공유 파일시스템 위의 저장소는 이 호스트의 세션 기록만으로 행위자를 배제할 수 없다.
- 배포 파이프라인이 `push → 자동배포 → 운영 DB 마이그레이션 실행`으로 직결돼 있으면, **저장소 쓰기 권한 = 운영 DB 쓰기 권한**이다. 토큰 노출의 영향 범위를 코드가 아니라 **데이터**로 계산해야 한다.
