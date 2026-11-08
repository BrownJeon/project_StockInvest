# T-156 부팅·DB 초기화 진단 보완

사용자가 원래 질문 `call_0a3113cce3cf42359ded296a2ad9f7e7`에 ‘부팅 진단 보완까지 진행 (추천)’로 답해 후속 범위를 승인했다. v6 배포 실패·자동 복구 경과는 기존 paper-v6 구현 보고서와 배포 후속 검토안을 따른다. 진단 자체는 원인 해결로 주장하지 않는다.

## 변경 범위

- `src/lib/diagnostics/boot-diagnostics.ts`: 고정 span과 setup 지역 Pool facade. 원래 receiver/인자/반환값/Promise·오류 동일성을 보존해 별도 관측한다.
- `src/lib/db.ts`: ensureSetup과 setup 전용 pool에 관측 연결, finally로 리스너 정리.
- `src/app/api/health/route.ts`: setup 대기와 기존 설정 Promise.all을 각각 관측. 응답/성공조건은 같다.
- 관련 unit: 비간섭·타이머 정리·로그 예외 격리·SQL/값 비노출·동시성/큐 구분을 검증한다.

로그 phase는 ensure_setup/setup_db/health_setup_wait/health_config_fanout, 작업은 순번·허용된 SQL class·총 경과시간이다. query 시간은 풀 획득과 SQL 실행이 합쳐진 시간이며 둘을 정확히 분리한 값으로 해석하지 않는다. enqueue는 해당 풀 전체의 이벤트여서 특정 query에 귀속하지 않는다. 별도 프로세스/Next 모듈 인스턴스는 별도 budget을 가질 수 있다.

30초 pending 단발, 5초 이상 완료 및 제한된 오류 code를 기록하며 모듈 인스턴스당 240개 budget을 둔다. 원문 SQL/인자·에러 메시지·인증정보·계좌·금액은 새 로그에 기록하지 않는다. 타이머는 unref·정리하고 진단 실패는 본래 작업의 결과를 바꾸지 않는다. 기존 SQL/DDL/재시도/연결한도/안전설정/health 제한시간을 바꾸지 않았다. 공개 진단 API·필드를 추가하지 않았다.

## 검증 결과

독립 Reviewer가 4개 진단 파일과 기존 19개 제품 파일을 검토했다. watchdog 예외 경계 지적은 수정 후 재검토됐다. 격리 7개 스위트/208개 테스트와 TypeScript·Next build가 통과했으며 전후 소스 해시가 같다. 기존 UI/M40 388개 검사의 대상 19개는 불변이다. 숫자를 합산한 고유 검사 수로 주장하지 않는다.

원본319 대비 query/execute 호출 78개 SQL·인자 표현식의 정적 AST와 순서가 같았다. 실제 mysql2 3.15.0/MariaDB10.11.11 별도 합성 DB에서 query/execute 결과·인자/receiver/Promise 동일성, SQL 오류 후 재사용, connectionLimit1 대기 이벤트, close 후 리스너 복원을 추가 확인했다. 전용 합성 DB와 컨테이너는 정리했다. 전체 setupDB cold-start·실제 health 응답/운영 장애 원인은 이 격리 시험으로 검증한 것이 아니다.

증거는 artifacts/T-156-paper-analysis-v6-implementation/boot-diagnostics-review.json, boot-diagnostics/와 boot-qa/에 있다. 새 운영 확인은 검증된 SHA에 대해 정본 배포 경로를 쓰고, 제한된 읽기 전용 DB 상태와 고정 boot 로그만 동시 관측한다. 기존 health 관문을 통과해야 v6 운영 반영으로 판정한다. 현재 이 문서 시점에는 새 진단 포함 릴리스 게시/운영 확인 전이다.


## 운영 확인 결과

진단 포함39b2f749c3547cb0bbdbc954a406a204afff9f56을 게시했고 릴리스20261108-212559-39b2f749가health를통과해정상운영반영됐다. 최종소스23SHA일치·health200/dbtrue/safetygreen/DRYtrue/killfalse·web/cron각1online/restart0·익명paperAPI401·선택안전env해시불변을확인했다. DBmigrate/APK/수동중복배포없음.

읽기전용관측의ensure_setup완료span은79,277ms였고수집된setup단일작업최대19,071ms,enqueue기록2건이었다. enqueue는풀전체관측이고개별쿼리에귀속하지않는다. ALTER/CREATE실패기록에는기존setup에서처리하는존재확인오류가포함될수있으므로27개를치명실패라고해석하지않는다. 첫319배포실패의근본원인은아직확정할수없으며이번정상기동이그원인해결의증명은아니다. 진단모니터는종료·DB연결해제됐고원본JSONL/요약은deployment/에보존한다.
