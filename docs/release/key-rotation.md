# 릴리스 키 교체

공개 1차는 버전이 지정된 복수 공개키를 애플리케이션과 설치 페이지
빌드에 포함합니다. 원격으로 받은 root 문서를 곧바로 신뢰하는 자체
root rotation protocol은 제공하지 않습니다.

안전한 교체 순서:

1. 기존 키와 새 키를 함께 신뢰하는 앱·설치 페이지를 먼저 배포합니다.
2. 충분한 전환 기간 후 새 릴리스 키로 manifest를 서명합니다.
3. 이전 클라이언트가 새 키를 인식하는지 확인합니다.
4. 이전 키가 포함되지 않은 새 빌드를 배포해 폐기합니다.
5. 키 유출 시 해당 key ID를 폐기한 긴급 빌드와 공지를 배포합니다.

운영 private key는 workspace 밖의 제한된 경로에 `0600`으로 보관하고 RSA
3072 bit 이상을 사용합니다. 저장소에는 SPKI public PEM을 담은 key ring만
둡니다. GitHub release environment에는 private PEM의 base64 값을 secret으로,
key ID를 variable로 설정합니다. CI preflight는 public/private 일치 여부만
출력하고 private bytes, secret 설정 명령 인자, credential은 로그나 artifact에
남기지 않습니다.

새 키로 서명하기 전에는 기존 stable 클라이언트가 새 public key를 포함한
버전으로 실제 업데이트됐는지 확인합니다. revoked key, 유효기간 밖 key,
manifest key ID 불일치는 installer, 앱, host updater 모두 fail closed 해야
합니다.

향후 원격 root 교체가 필요하다면 threshold, root version, expiry,
rollback protection과 복구 절차를 포함한 별도 프로토콜로 설계합니다.
