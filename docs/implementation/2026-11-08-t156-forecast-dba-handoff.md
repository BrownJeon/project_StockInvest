# T-156 예측 원장 관리자 적용 인계

사용자는 **기존 DB 관리자 접속 프로필 사용**을 선택했다. 현재 필요한 정보는 **사용할 프로필의 실제 파일 경로**다. Mac·Ubuntu 기본 `.my.cnf`/`.mylogin.cnf` 및 MySQL/MariaDB/StockInvest 설정 폴더에서는 프로필이 확인되지 않았다. 같은 방식 승인을 다시 요청하지 않는다. 비밀번호·인증키를 대화에 보내지 않는다. 앱 계정의 SUPER 승격이나 전역 `log_bin_trust_function_creators` 완화는 요청하지 않는다.

## 검토된 적용 대상

- 운영 DB: NAS MariaDB의 `stockinvest`.
- SQL 정본: `scripts/migrations/T-156-forecast-ledger.sql`.
- SQL SHA-256: `163ce1df773754b5a331944be14eedcd357310ba19ae03d5f3bf5078aa67753b`.
- 운영 호스트의 동일 사본: `/home/brownjeon/.node-local/t156-forecast-ops-20261108/T-156-forecast-ledger.sql`.
- 검토·격리 검증한 신규 5개 표와 8개 불변 트리거만 포함한다. 기존 모의계좌·실계좌·실주문 표에 ALTER/UPDATE/DELETE를 수행하지 않는다.

현재 job/run/horizon/evaluation 4표가 비어 있는 상태로 생성됐고, 첫 CREATE TRIGGER가 오류 1419로 거부됐다. continuation 표와 트리거는 아직 없다. SQL 전체는 `IF NOT EXISTS`로 재실행할 수 있다. 실제 DB의 원인·상태·전후 지문은 `agent-vault/10-Flow/artifacts/T-156-forecast-engine/migration-blocker.json`에 있다.

## 관리자 실행 순서

1. 대상 서버·DB `stockinvest`와 위 파일 해시를 확인한다. 기존 인증 프로필은 보호된 파일/서비스 수단을 사용하며 내용이나 비밀번호를 출력하지 않는다.
2. 관리자 세션에서 검토 SQL 전체를 **선택한 운영 DB에** 적용한다. 기존 신규 빈 표를 삭제할 필요는 없다. 새 스키마/사용자/권한·전역 변수 변경은 포함하지 않는다.
3. Root가 앱 계정으로 읽기 전용 후검증 도구를 실행한다. `/home/brownjeon/.node-local/t156-forecast-ops-20261108/forecast-schema-verify.mjs --postflight`는 8개 트리거의 이름·대상·동작·단일 SIGNAL 본문까지 대조한다. 단순 개수만으로 통과하지 않는다.
4. 신규 5표·8트리거와 기존 모의계좌·이력·안전 설정의 지문 불변을 확인한다. 불일치가 있으면 발행·배포를 진행하지 않는다.
5. 통과 후 승인된 코드 배포·실자료 예측 1건/4기간 발행·중복 방지·소유자 조회·DRY_RUN을 검증한다. 만기 전 실제 성과를 만들지 않는다.

현재는 기존 운영 코드가 새 표를 사용하지 않으므로 빈 표 4개를 보존한 채 대기할 수 있다. 복구를 위해 이미 발행된 예측이나 기존 모의투자 자료를 삭제하지 않는다. 이 문서는 관리자 연결 정보를 새로 만들거나 공유하라는 지시가 아니다.
