# 릴리스 서명

릴리스 개인 키는 저장소, 컨테이너 이미지, 설치 꾸러미 또는 일반 CI
artifact에 포함하지 않습니다. 보호된 CI 환경 또는 별도 서명
시스템에서만 접근합니다.

릴리스 게시 순서:

```text
빌드와 테스트
→ 임시 이미지와 draft 자산
→ digest·크기 계산
→ manifest 생성
→ detached signature 생성
→ 모든 자산 재검증
→ 이전 stable을 보존한 Pages stage 배포
→ GitHub Immutable Release 공개(아직 latest 아님)
→ stable 채널을 교체하고 공개 바이트 재검증
→ GHCR stable과 GitHub latest를 마지막에 갱신
```

중간 단계가 실패하면 기존 stable manifest를 변경하지 않습니다.
동일 버전 자산 덮어쓰기와 서명된 tag 재사용을 허용하지 않습니다.
저장소의 **Settings → Releases → Enable release immutability**가 꺼져
있으면 릴리스 workflow는 게시를 시작하지 않습니다. 채널 단위
concurrency와 직전 서명 manifest의 version·sequence 검증으로 느린
구버전 workflow가 stable을 되돌리지 못하게 합니다.
