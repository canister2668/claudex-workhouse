// The worker settings page is a standalone document served from 127.0.0.1, so it
// cannot use the app's Svelte dictionary. Copy lives here and the language is picked
// from the browser's Accept-Language header on every request.

export type WorkerUiLocale = "ko" | "en" | "ja";

export function resolveWorkerUiLocale(acceptLanguage: string | undefined): WorkerUiLocale {
  for (const part of String(acceptLanguage ?? "").split(",")) {
    const tag = part.split(";")[0].trim().toLowerCase();
    if (tag.startsWith("ko")) return "ko";
    if (tag.startsWith("ja")) return "ja";
    if (tag.startsWith("en")) return "en";
  }
  return "en";
}

export interface WorkerUiCopy {
  lang: WorkerUiLocale;
  page: Record<string, string>;
  /** Strings the inline script needs; serialized into the page as JSON. */
  script: Record<string, string>;
  errors: Record<string, string>;
  folderDialogTitle: string;
}

const COPY: Record<WorkerUiLocale, Omit<WorkerUiCopy, "lang">> = {
  ko: {
    page: {
      heading: "Claudex Workhouse Desktop Worker",
      hostLine: "로컬 Worker 설정",
      checking: "확인 중",
      connectTitle: "Claudex Workhouse 연결",
      serverAddress: "Claudex Workhouse 주소",
      pairingCode: "페어링 코드",
      computerName: "이 컴퓨터 이름",
      connect: "연결하기",
      pairHint: "Claudex Workhouse 글로벌 설정 → 실행 호스트에서 발급한 10분짜리 코드를 입력하세요.",
      workspaceRoots: "작업공간 Root",
      newRootFolder: "새 Root 폴더",
      pickFolderPlaceholder: "폴더 선택 버튼을 누르세요",
      pickFolder: "폴더 선택",
      displayName: "표시 이름",
      addRoot: "Root 추가",
      rootHint: "드라이브 전체와 사용자 홈 전체는 등록할 수 없습니다.",
      operations: "운영",
      autostart: "로그인할 때 자동 실행",
      autostartHint: "현재 사용자 권한으로만 실행됩니다.",
      runDiagnostics: "진단 실행",
      refreshState: "상태 새로고침",
      unpair: "연결 해제",
      closeSettings: "설정만 닫기",
      footer: "관리 화면은 이 컴퓨터의 127.0.0.1에서만 열리며 Worker credential을 표시하지 않습니다."
    },
    script: {
      responseUnreadable: "응답을 읽을 수 없습니다.",
      requestFailed: "요청에 실패했습니다.",
      stateOnline: "온라인",
      stateConnecting: "연결 중",
      stateOffline: "오프라인",
      stateManaged: "자동 실행 서비스",
      stateStopped: "중지됨",
      stateUnpaired: "연결 필요",
      remove: "제거",
      connecting: "연결하는 중…",
      connected: "Claudex Workhouse와 연결했습니다.",
      openingPicker: "폴더 선택창을 여는 중…",
      pickerCancelled: "폴더 선택을 취소했습니다.",
      rootAdded: "Root를 추가했습니다.",
      confirmRemoveRoot: "이 Root 등록을 제거할까요? 실제 파일은 삭제되지 않습니다.",
      rootRemoved: "Root 등록을 제거했습니다.",
      autostartOn: "자동 실행을 켰습니다.",
      autostartOff: "자동 실행을 껐습니다.",
      diagnosing: "진단하는 중…",
      diagnosed: "진단을 완료했습니다.",
      confirmUnpair: "Worker 연결을 해제할까요? 작업 파일과 Root는 유지됩니다.",
      unpaired: "연결을 해제했습니다.",
      quitTitle: "Claudex Workhouse Worker 설정창을 종료했습니다.",
      quitBody: "이 탭을 닫아도 됩니다."
    },
    errors: {
      urlUserInfo: "서버 주소에 사용자 정보를 넣을 수 없습니다.",
      httpsRequired: "HTTPS Claudex Workhouse 주소가 필요합니다.",
      pairCode: "페어링 코드 형식을 확인하세요.",
      computerName: "컴퓨터 이름을 확인하세요.",
      rootInput: "Root 정보를 확인하세요.",
      rootNotFound: "Root를 찾을 수 없습니다."
    },
    folderDialogTitle: "Claudex Workhouse 작업공간 Root 선택"
  },
  en: {
    page: {
      heading: "Claudex Workhouse Desktop Worker",
      hostLine: "Local worker settings",
      checking: "Checking",
      connectTitle: "Connect to Claudex Workhouse",
      serverAddress: "Claudex Workhouse address",
      pairingCode: "Pairing code",
      computerName: "This computer's name",
      connect: "Connect",
      pairHint: "Enter the 10-minute code issued under Claudex Workhouse global settings → execution hosts.",
      workspaceRoots: "Workspace roots",
      newRootFolder: "New root folder",
      pickFolderPlaceholder: "Use the folder picker",
      pickFolder: "Choose folder",
      displayName: "Display name",
      addRoot: "Add root",
      rootHint: "A whole drive or an entire user home cannot be registered.",
      operations: "Operations",
      autostart: "Start automatically at login",
      autostartHint: "Runs with the current user's privileges only.",
      runDiagnostics: "Run diagnostics",
      refreshState: "Refresh status",
      unpair: "Disconnect",
      closeSettings: "Close settings only",
      footer: "This admin page opens only on 127.0.0.1 of this computer and never shows the worker credential."
    },
    script: {
      responseUnreadable: "The response could not be read.",
      requestFailed: "The request failed.",
      stateOnline: "Online",
      stateConnecting: "Connecting",
      stateOffline: "Offline",
      stateManaged: "Autostart service",
      stateStopped: "Stopped",
      stateUnpaired: "Not connected",
      remove: "Remove",
      connecting: "Connecting…",
      connected: "Connected to Claudex Workhouse.",
      openingPicker: "Opening the folder picker…",
      pickerCancelled: "Folder selection was cancelled.",
      rootAdded: "The root was added.",
      confirmRemoveRoot: "Remove this root registration? The actual files are not deleted.",
      rootRemoved: "The root registration was removed.",
      autostartOn: "Autostart is on.",
      autostartOff: "Autostart is off.",
      diagnosing: "Running diagnostics…",
      diagnosed: "Diagnostics finished.",
      confirmUnpair: "Disconnect this worker? Task files and roots are kept.",
      unpaired: "The worker was disconnected.",
      quitTitle: "The Claudex Workhouse worker settings window was closed.",
      quitBody: "You can close this tab."
    },
    errors: {
      urlUserInfo: "The server address cannot contain user information.",
      httpsRequired: "An HTTPS Claudex Workhouse address is required.",
      pairCode: "Check the pairing code format.",
      computerName: "Check the computer name.",
      rootInput: "Check the root details.",
      rootNotFound: "The root could not be found."
    },
    folderDialogTitle: "Select a Claudex Workhouse workspace root"
  },
  ja: {
    page: {
      heading: "Claudex Workhouse Desktop Worker",
      hostLine: "ローカルWorkerの設定",
      checking: "確認中",
      connectTitle: "Claudex Workhouseに接続",
      serverAddress: "Claudex Workhouseのアドレス",
      pairingCode: "ペアリングコード",
      computerName: "このコンピューターの名前",
      connect: "接続する",
      pairHint: "Claudex Workhouseのグローバル設定 → 実行ホストで発行した10分間有効なコードを入力してください。",
      workspaceRoots: "ワークスペースRoot",
      newRootFolder: "新しいRootフォルダー",
      pickFolderPlaceholder: "フォルダー選択ボタンを押してください",
      pickFolder: "フォルダーを選択",
      displayName: "表示名",
      addRoot: "Rootを追加",
      rootHint: "ドライブ全体やユーザーホーム全体は登録できません。",
      operations: "運用",
      autostart: "ログイン時に自動実行",
      autostartHint: "現在のユーザー権限でのみ実行されます。",
      runDiagnostics: "診断を実行",
      refreshState: "状態を更新",
      unpair: "接続を解除",
      closeSettings: "設定のみ閉じる",
      footer: "この管理画面はこのコンピューターの127.0.0.1でのみ開き、Workerのcredentialは表示しません。"
    },
    script: {
      responseUnreadable: "応答を読み取れませんでした。",
      requestFailed: "リクエストに失敗しました。",
      stateOnline: "オンライン",
      stateConnecting: "接続中",
      stateOffline: "オフライン",
      stateManaged: "自動実行サービス",
      stateStopped: "停止中",
      stateUnpaired: "接続が必要",
      remove: "削除",
      connecting: "接続しています…",
      connected: "Claudex Workhouseに接続しました。",
      openingPicker: "フォルダー選択画面を開いています…",
      pickerCancelled: "フォルダーの選択を取り消しました。",
      rootAdded: "Rootを追加しました。",
      confirmRemoveRoot: "このRoot登録を削除しますか? 実際のファイルは削除されません。",
      rootRemoved: "Root登録を削除しました。",
      autostartOn: "自動実行を有効にしました。",
      autostartOff: "自動実行を無効にしました。",
      diagnosing: "診断しています…",
      diagnosed: "診断が完了しました。",
      confirmUnpair: "Workerの接続を解除しますか? タスクファイルとRootは保持されます。",
      unpaired: "接続を解除しました。",
      quitTitle: "Claudex Workhouse Workerの設定画面を終了しました。",
      quitBody: "このタブを閉じても構いません。"
    },
    errors: {
      urlUserInfo: "サーバーアドレスにユーザー情報を含めることはできません。",
      httpsRequired: "HTTPSのClaudex Workhouseアドレスが必要です。",
      pairCode: "ペアリングコードの形式を確認してください。",
      computerName: "コンピューター名を確認してください。",
      rootInput: "Rootの情報を確認してください。",
      rootNotFound: "Rootが見つかりませんでした。"
    },
    folderDialogTitle: "Claudex Workhouseのワークスペース Rootを選択"
  }
};

export function workerUiCopy(locale: WorkerUiLocale): WorkerUiCopy {
  return { lang: locale, ...COPY[locale] };
}
