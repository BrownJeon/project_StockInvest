---
project: StockInvest
created: 2026-10-31
tags:
  - type/knowledge
  - type/runbook
  - domain/infra
aliases:
  - pm2 로그 회전
  - logrotate
---

# StockInvest pm2 로그 회전 (시스템 logrotate)

2026-10-31 사용자 결정 「권고대로(주 1회+20MB)」 — [[T-131-t126-t130-followup-candidates]] 18번. 서버에 회전 도구가 없었고(pm2 한 개가 17개 앱을 돌린다), 이 프로젝트의 로그 4개만 회전한다.

## 정책 (설정 파일 그대로)

| 항목 | 값 | 뜻 |
|---|---|---|
| 대상 | `/home/brownjeon/apps/stockinvest/shared/logs/` 의 `pm2-out.log` · `pm2-err.log` · `cron-out.log` · `cron-err.log` | 다른 프로젝트 pm2 로그는 건드리지 않는다 |
| 시간 기준 | `weekly` | 일요일 경계가 지나면 회전 |
| 크기 기준 | `maxsize 20M` | 주 중이라도 20MB 를 넘으면 회전 (시간 또는 크기, 먼저 오는 쪽) |
| 보관 | `rotate 8` | 최근 8개(약 2개월), 그보다 오래된 것은 삭제 |
| 압축 | `compress` + `delaycompress` | 직전 회전 파일은 **압축 없이** 한 주 둔다(grep 하기 쉽게), 그다음 회전 때 `.gz` |
| 방식 | `copytruncate` | 파일을 복사한 뒤 비운다 (아래 「알려진 한계」) |
| 이름 | `dateext`, `-YYYYMMDD` | 예: `pm2-out.log-20261101` |
| 빈 파일 | `notifempty` · `missingok` | 비어 있으면 회전하지 않고, 없어도 오류 아님 |

## 어디에 무엇이 있나 (서버, 로컬 디스크 — NFS 아님)

| 무엇 | 경로 |
|---|---|
| 설정 | `~/.node-local/stockinvest/logrotate/stockinvest.conf` (정본은 서버 파일; 이 문서 표는 사본) |
| 상태(마지막 회전 시각) | `~/.node-local/stockinvest/logrotate/state` |
| 실행 기록(**오류만** 남는다 — 비어 있으면 정상) | `~/.node-local/stockinvest/logrotate/run.log` |
| 원래 crontab 백업 | `~/.node-local/stockinvest/logrotate/crontab.backup-20261031` |
| 실행 | 사용자 crontab 한 줄: `15 4 * * * /usr/sbin/logrotate -s …/state …/stockinvest.conf >> …/run.log 2>&1` (`crontab -l` 마지막 줄, 매일 04:15 — 같은 날 일요일 04:00 BJJ yt-dlp 업데이트와 겹치지 않음) |

## 첫 회전은 언제인가

상태 파일을 **2026-10-31(토) 21:00 으로 초기화**했다(그때 회전하지 않았다). 주간 규칙은 「오늘 요일이 마지막 회전 요일보다 이르면(일요일 0 < 토요일 6)」 회전이므로 **11-01(일) 04:15 에 4개 파일이 처음 회전**한다. 이후 매주 일요일 04:15, 또는 20MB 를 넘은 날 04:15.

회전 후 모습(예): `pm2-out.log`(비워져 새로 쌓임) · `pm2-out.log-20261101`(직전 한 주 — 압축 안 됨) → 다음 회전에 `pm2-out.log-20261101.gz` 로 압축되고, 9번째 오래된 것은 삭제.

## 왜 이 방식이 안전한가 (10-31 시험)

- 로그를 쓰는 프로세스가 전부 **O_APPEND** 로 열고 있다 — `cron-*.log` 는 PM2 God Daemon, `pm2-*.log` 는 `next-server` 워커(`/proc/<pid>/fdinfo` 플래그 `02102001`). 그래서 파일을 비워도 이전 오프셋부터 쓰는 **희소 파일(앞부분 NUL)** 이 생기지 않는다. 임시 디렉터리 시험에서 NUL 바이트 0 개.
- 규칙 시험(임시 디렉터리): 상태가 없는 첫 실행은 회전하지 않고 상태만 만든다 · 마지막 회전이 8일 전이면 주간 규칙으로 회전 · 21MB 파일은 시간과 무관하게 크기 상한으로 회전 · `rotate 2` 로 4번 회전하면 최신 2개만 남고 직전 것은 `.gz`, 최신은 비압축.

## 알려진 한계

- **`copytruncate` 는 복사~비움 사이(수 ms)에 쓰인 줄을 잃을 수 있다.** 시험: 초당 약 1,000줄 부하에서 6,000줄 중 7줄 유실(667~673번). 실제 로그는 하루 약 3,300줄(초당 약 0.04줄)이라 회전 1회의 기대 유실은 사실상 0줄이지만 0 이라고 보장하지는 않는다.
- 회전 직후엔 `pm2-out.log` 가 짧다. **시간 범위가 회전 경계를 넘는 점검**(예: 「일요일 04:15 이전부터의 로그」)은 `pm2-out.log-YYYYMMDD`(압축 전) 또는 `.gz`(`zgrep -a`)도 읽어야 한다. `cron-out.log` 는 `grep -a`.
- 범위 밖(회전하지 않음): BJJ `~/.pm2/logs/bjj-out.log`(50MB, 활성) · 정지된 앱의 큰 파일(`tradinginvest-out-15.log` 84MB, `theroute-out.log` 35MB) · `shared/logs/api-usage-YYYY-MM-DD.jsonl`(하루 약 4MB, 월 약 120MB 가 보관 정책 없이 쌓임 — 별개 항목).
- 이 4개 파일을 읽는 코드는 없다(StockInvest `src`·`scripts`, HOME-SERVER 검색 0건). 읽는 것은 사람의 `grep` 과 이 vault 의 런북뿐이다.

## 확인·조정·되돌리기

```bash
cat ~/.node-local/stockinvest/logrotate/state                 # 마지막 회전 시각 (회전하면 갱신)
ls -l /home/brownjeon/apps/stockinvest/shared/logs/           # 회전 파일 확인
cat ~/.node-local/stockinvest/logrotate/run.log               # 비어 있으면 정상
# 수동 드라이런(아무것도 바꾸지 않음) — 반드시 임시 state 를 쓴다:
cp ~/.node-local/stockinvest/logrotate/state /tmp/lr.state && /usr/sbin/logrotate -d -s /tmp/lr.state ~/.node-local/stockinvest/logrotate/stockinvest.conf
```

- **값 조정**: 설정 파일의 `weekly`·`maxsize`·`rotate` 를 고친다(다음 04:15 실행부터 반영).
- **끄기**: `crontab -e` 로 마지막 세 줄(빈 줄 제외 주석 2 + 실행 1)을 지운다. 이미 회전된 파일은 지우지 않는다. 원래 crontab 을 통째로 되돌리는 `crontab <백업>` 은 그 뒤 추가된 항목까지 덮어쓰므로 줄 삭제를 권한다.
- **재부팅**: cron 데몬이 다시 뜨면 그대로 동작한다(상태 파일은 로컬 디스크에 유지).

## 이력

- 2026-10-31 설정(사용자 「권고대로(주 1회+20MB)」). 샌드박스 시험 2회 → 실제 설정 드라이런 → 상태 초기화 → crontab 한 줄. **첫 회전 확인은 11-01(일) 04:30 예약 점검 또는 사람이 위 명령으로.**
- 2026-11-01 04:29 KST 첫 회전 확인(읽기 전용): 04:15 에 4개 파일 모두 회전 — 상태 파일 4건 `2026-11-1-4:15:1` 갱신, `*.log-20261101` 4개 생성(pm2-out 8.33MB · pm2-err 3.82MB · cron-out 9.52MB · cron-err 0.22MB, 압축 안 됨 = 설정대로), 살아 있는 파일은 비워진 뒤 정상 기록 중(cron-out 2925→3104B/30초 증가, pm2-out 353B 는 NUL 0 개라 O_APPEND 확인, pm2-err·cron-err 는 0B = 새 오류 없음), `run.log` 0B(오류 없음), pm2 2개 online·restarts 0·health green(dryRun true·killSwitch false), 안전 키 6개 불변, crontab 활성 4줄 불변. **이상 없음.** 다음 회전은 11-08(일) 04:15 또는 20MB 초과일(그때 `-20261101` 이 `.gz` 로 압축).
