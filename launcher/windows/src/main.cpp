// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Claudex Workhouse.

#include <windows.h>
#include <bcrypt.h>
#include <commctrl.h>
#include <dwmapi.h>
#include <winhttp.h>
#include <shellapi.h>
#include <shlobj.h>
#include <algorithm>
#include <array>
#include <cwchar>
#include <cwctype>
#include <filesystem>
#include <fstream>
#include <cstring>
#include <cstdlib>
#include <regex>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <tuple>
#include <vector>

namespace {
constexpr wchar_t kWindowClass[]=L"ClaudexWorkhouseInstallerWindow";
constexpr wchar_t kMutex[]=L"Local\\ClaudexWorkhouseWindowsServer";
constexpr UINT_PTR kPollTimer=1;
constexpr UINT kInstallFinished=WM_APP+1;
constexpr int kInstall=101,kCancel=102,kLanguage=103,kBrowse=104,kLanguageFirst=201;
constexpr int kBaseWidth=700,kBaseHeight=430;
constexpr DWORD kImmersiveDarkMode=20;
enum class WizardState{Welcome,Installing,Starting,Ready,Failed};
enum class Locale{En,Ko,Ja};
constexpr size_t kLocaleCount=3;
const wchar_t* const kLocaleNames[kLocaleCount]={L"English",L"한국어",L"日本語"};
const wchar_t* const kLocaleTags[kLocaleCount]={L"en",L"ko",L"ja"};
enum class Text{None,PortableStartingBody,PortableFailedBody,WindowTitle,StatusWindowTitle,WelcomeTitle,WelcomeBody,InstallLocation,InstallLocationUnknown,InstallingTitle,InstallingBody,StartingTitle,StartingBody,StartingPath,StatusStartingTitle,StatusStartingBody,ReadyTitle,ReadyBody,StatusReadyTitle,StatusReadyBody,ReadyAttention,ReadyConfigFailed,FailedTitle,FailedBody,StatusFailedTitle,StatusFailedBody,FailedCause,ErrorLog,PortBusy,ProbeWait,UpdateStopping,BusyClose,ButtonInstall,ButtonInstalling,ButtonStarting,ButtonCancel,ButtonOpen,ButtonFinish,ButtonRetry,ButtonClose,ButtonBrowse,BrowseTitle,ThisComputer,OtherDevices,OtherDevicesHint,UninstallConfirm,UninstallComplete,UninstallFailed,Count};
struct Phrase{const wchar_t* value[kLocaleCount];};
// Order matches the Text enum; the en column is the source language and every
// locale carries a complete translation so no user-visible string falls back.
const Phrase kPhrases[static_cast<size_t>(Text::Count)]={
  {{L"",L"",L""}},
  {{L"Verifying the files next to this launcher and starting the local server.\nNothing is installed on this computer.",L"이 실행 파일 옆의 파일을 확인하고 로컬 서버를 시작하고 있습니다.\n이 컴퓨터에 설치하지 않습니다.",L"この実行ファイルの隣にあるファイルを確認し、ローカルサーバーを起動しています。\nこのコンピューターにはインストールしません。"}},
  {{L"The portable Workhouse server could not be verified or started.\nTry again, or check the launcher log for the detailed cause.",L"포터블 Workhouse 서버를 확인하거나 시작하지 못했습니다.\n다시 시도하거나 런처 로그에서 자세한 원인을 확인하세요.",L"ポータブル版 Workhouse サーバーを確認または起動できませんでした。\n再試行するか、ランチャーログで詳しい原因を確認してください。"}},
  {{L"Claudex Workhouse Setup",L"Claudex Workhouse 설치",L"Claudex Workhouse セットアップ"}},
  {{L"Claudex Workhouse Server",L"Claudex Workhouse 서버",L"Claudex Workhouse サーバー"}},
  {{L"Install Claudex Workhouse",L"Claudex Workhouse 설치",L"Claudex Workhouse をインストール"}},
  {{L"The Workhouse server is installed for the current user on this computer.\nWhen setup finishes you can use it straight from your browser.",L"이 컴퓨터의 현재 사용자 영역에 Workhouse 서버를 설치합니다.\n설치가 끝나면 브라우저에서 바로 사용할 수 있습니다.",L"このコンピューターの現在のユーザー領域に Workhouse サーバーをインストールします。\nセットアップが完了すると、ブラウザーからすぐに利用できます。"}},
  {{L"Install location: ",L"설치 위치: ",L"インストール先: "}},
  {{L"The install location could not be determined.",L"설치 위치를 확인할 수 없습니다.",L"インストール先を確認できません。"}},
  {{L"Installing",L"설치 중",L"インストール中"}},
  {{L"Verifying file integrity and installing into your user folder.\nKeep this window open until the work finishes.",L"파일 무결성을 확인하고 안전한 사용자 폴더에 설치하고 있습니다.\n이 작업이 끝날 때까지 창을 닫지 마세요.",L"ファイルの整合性を確認し、ユーザーフォルダーにインストールしています。\n完了するまでこのウィンドウを閉じないでください。"}},
  {{L"Starting the server",L"서버 시작 중",L"サーバーを起動中"}},
  {{L"Installation finished. Waiting for the server to become ready…",L"설치는 완료되었습니다. 서버가 준비될 때까지 기다리는 중입니다…",L"インストールは完了しました。サーバーの準備が整うまで待機しています…"}},
  {{L"Checking the installed files and the local server status.",L"설치된 파일과 로컬 서버 상태를 확인하고 있습니다.",L"インストール済みファイルとローカルサーバーの状態を確認しています。"}},
  {{L"Checking the server",L"서버 확인 중",L"サーバーを確認中"}},
  {{L"Starting the installed server and checking its status.\nKeep this window open until the check finishes.",L"설치된 서버를 시작하고 상태를 확인하고 있습니다.\n확인이 끝날 때까지 이 창을 열어 두세요.",L"インストール済みサーバーを起動し、状態を確認しています。\n確認が終わるまでこのウィンドウを開いたままにしてください。"}},
  {{L"Setup complete",L"설치 완료",L"セットアップ完了"}},
  {{L"Claudex Workhouse is installed and the server is ready.\nSelect “Open Workhouse” to continue with the first-run setup.",L"Claudex Workhouse가 설치되었고 서버가 준비되었습니다.\n‘Workhouse 열기’를 눌러 초기 설정을 계속하세요.",L"Claudex Workhouse をインストールし、サーバーの準備が整いました。\n「Workhouse を開く」を選択して初期設定を続けてください。"}},
  {{L"Server ready",L"서버 준비 완료",L"サーバー準備完了"}},
  {{L"The Workhouse server is running. Open it in your browser or use the addresses below to connect.",L"Workhouse 서버가 실행 중입니다. 브라우저에서 열거나 아래 주소로 접속하세요.",L"Workhouse サーバーは実行中です。ブラウザーで開くか、下のアドレスから接続してください。"}},
  {{L"Installation and server startup finished.\nOpen Workhouse to continue with provider sign-in or workspace setup.",L"설치와 서버 시작이 완료되었습니다.\nWorkhouse를 열어 Provider 로그인 또는 Workspace 설정을 계속하세요.",L"インストールとサーバーの起動が完了しました。\nWorkhouse を開いてプロバイダーのサインインまたはワークスペース設定を続けてください。"}},
  {{L"Installation finished, but the initial configuration needs attention.\nOpen Workhouse to review the diagnostics.",L"설치는 완료되었지만 초기 구성에 확인이 필요합니다.\nWorkhouse를 열어 진단 내용을 확인하세요.",L"インストールは完了しましたが、初期構成の確認が必要です。\nWorkhouse を開いて診断内容を確認してください。"}},
  {{L"Setup failed",L"설치 실패",L"セットアップ失敗"}},
  {{L"Claudex Workhouse could not be installed or started.\nTry again, or check the installer log for the detailed cause.",L"Claudex Workhouse를 설치하거나 시작하지 못했습니다.\n다시 시도하거나 설치 로그에서 자세한 원인을 확인하세요.",L"Claudex Workhouse をインストールまたは起動できませんでした。\n再試行するか、インストールログで詳しい原因を確認してください。"}},
  {{L"Server check failed",L"서버 확인 실패",L"サーバー確認失敗"}},
  {{L"The installed Workhouse server could not be started or checked.\nTry again, or check the launcher log for the detailed cause.",L"설치된 Workhouse 서버를 시작하거나 확인하지 못했습니다.\n다시 시도하거나 런처 로그에서 자세한 원인을 확인하세요.",L"インストール済み Workhouse サーバーを起動または確認できませんでした。\n再試行するか、ランチャーログで詳しい原因を確認してください。"}},
  {{L"Cause: ",L"원인: ",L"原因: "}},
  {{L"Error log: ",L"오류 로그: ",L"エラーログ: "}},
  {{L"Another program is using the local server port.",L"다른 프로그램이 로컬 서버 포트를 사용 중입니다.",L"別のプログラムがローカルサーバーのポートを使用しています。"}},
  {{L"Checking the server response…",L"서버 응답을 확인하는 중…",L"サーバーの応答を確認しています…"}},
  {{L"Stopping the server to apply an update…",L"업데이트를 적용하기 위해 서버를 종료합니다…",L"更新を適用するためにサーバーを停止しています…"}},
  {{L"Installation and server startup are in progress. Please wait until they finish.",L"설치와 서버 시작이 진행 중입니다. 완료될 때까지 기다려 주세요.",L"インストールとサーバーの起動が進行中です。完了するまでお待ちください。"}},
  {{L"Install",L"설치",L"インストール"}},
  {{L"Installing…",L"설치 중…",L"インストール中…"}},
  {{L"Checking…",L"확인 중…",L"確認中…"}},
  {{L"Cancel",L"취소",L"キャンセル"}},
  {{L"Open Workhouse",L"Workhouse 열기",L"Workhouse を開く"}},
  {{L"Finish",L"마침",L"完了"}},
  {{L"Try again",L"다시 시도",L"再試行"}},
  {{L"Close",L"닫기",L"閉じる"}},
  {{L"Browse…",L"변경…",L"変更…"}},
  {{L"Select a parent folder. Setup creates a dedicated Claudex Workhouse folder inside it.",L"상위 폴더를 선택하세요. 안에 Claudex Workhouse 전용 폴더를 만듭니다.",L"親フォルダーを選択してください。その中に Claudex Workhouse 専用フォルダーを作成します。"}},
  {{L"This PC: ",L"이 PC: ",L"この PC: "}},
  {{L"Other devices: ",L"다른 기기: ",L"ほかのデバイス: "}},
  {{L"Configure LAN or external access in Workhouse",L"Workhouse에서 LAN 또는 외부 접속을 설정하세요",L"Workhouse で LAN または外部アクセスを設定してください"}},
  {{L"Remove Claudex Workhouse from this computer?\n\nThe server will stop. App files and shortcuts will be removed. Your settings, credentials, logs, and workspaces will be kept.",L"이 컴퓨터에서 Claudex Workhouse를 제거할까요?\n\n서버가 종료되고 프로그램 파일과 바로가기가 삭제됩니다. 설정, 자격 증명, 로그, 작업공간은 보존됩니다.",L"このコンピューターから Claudex Workhouse を削除しますか？\n\nサーバーを停止し、アプリのファイルとショートカットを削除します。設定、資格情報、ログ、ワークスペースは保持されます。"}},
  {{L"Claudex Workhouse was removed. Your user data was kept.",L"Claudex Workhouse를 제거했습니다. 사용자 데이터는 보존했습니다.",L"Claudex Workhouse を削除しました。ユーザーデータは保持されています。"}},
  {{L"Claudex Workhouse could not be removed completely.",L"Claudex Workhouse를 완전히 제거하지 못했습니다.",L"Claudex Workhouse を完全に削除できませんでした。"}},
};
struct Palette{COLORREF surface,band,border,title,body,muted,accent,accentPressed,accentText,quietFill,quietPressed,disabledFill,disabledText;};
const Palette kLightPalette{RGB(255,255,255),RGB(247,247,248),RGB(226,226,230),RGB(23,23,26),RGB(45,45,52),RGB(110,110,120),RGB(15,108,189),RGB(11,86,151),RGB(255,255,255),RGB(255,255,255),RGB(238,238,242),RGB(238,238,240),RGB(160,160,168)};
const Palette kDarkPalette{RGB(32,32,36),RGB(40,40,45),RGB(60,60,66),RGB(244,244,246),RGB(226,226,232),RGB(158,158,168),RGB(58,140,214),RGB(44,112,175),RGB(255,255,255),RGB(48,48,54),RGB(58,58,66),RGB(52,52,58),RGB(120,120,130)};
HWND g_window=nullptr,g_title=nullptr,g_status=nullptr,g_path=nullptr,g_progress=nullptr,g_installButton=nullptr,g_cancelButton=nullptr,g_languageButton=nullptr,g_browseButton=nullptr;HFONT g_titleFont=nullptr,g_bodyFont=nullptr,g_captionFont=nullptr,g_badgeFont=nullptr;HBRUSH g_surfaceBrush=nullptr,g_bandBrush=nullptr;int g_dpi=96;bool g_dark=false;Locale g_locale=Locale::En;Text g_statusKey=Text::None;HANDLE g_installThread=nullptr;WizardState g_wizardState=WizardState::Welcome;PROCESS_INFORMATION g_server{};HANDLE g_job=nullptr,g_serverLog=nullptr;bool g_ownsServer=false,g_entryConsumed=false,g_updateStarted=false,g_autoInstall=false,g_uninstall=false,g_quietUninstall=false,g_installedStatusMode=false,g_portableMode=false;unsigned long long g_embeddedLauncherSize=0;std::wstring g_origin=L"http://127.0.0.1:3410",g_external,g_entryToken;std::string g_startError,g_launcherDiagnosis;bool g_diagnose=false;std::filesystem::path g_installRoot,g_payloadRoot,g_requestedInstallRoot;

// True for both launcher forms that own no installation wizard: the registered
// installed status launcher and the extracted portable folder. Both verify what
// is already on disk and start the server immediately.
bool directStartMode(){return g_installedStatusMode||g_portableMode;}
const wchar_t* text(Text key){return kPhrases[static_cast<size_t>(key)].value[static_cast<size_t>(g_locale)];}

std::filesystem::path executablePath(){std::vector<wchar_t> buffer(32768);DWORD size=GetModuleFileNameW(nullptr,buffer.data(),static_cast<DWORD>(buffer.size()));if(!size||size>=static_cast<DWORD>(buffer.size()))throw std::runtime_error("launcher path");return std::filesystem::path(std::wstring(buffer.data(),size));}
std::string readBytes(const std::filesystem::path& file){std::ifstream stream(file,std::ios::binary);if(!stream)throw std::runtime_error("missing current.json");return std::string(std::istreambuf_iterator<char>(stream),std::istreambuf_iterator<char>());}
size_t jsonValueStart(const std::string& body,const std::string& key){const auto marker="\""+key+"\"";const auto at=body.find(marker);if(at==std::string::npos)return std::string::npos;const auto colon=body.find_first_not_of(" \t\r\n",at+marker.size());if(colon==std::string::npos||body[colon]!=':')return std::string::npos;return body.find_first_not_of(" \t\r\n",colon+1);}
std::string jsonString(const std::string& body,const std::string& key){const auto first=jsonValueStart(body,key);if(first==std::string::npos||first>=body.size()||body[first]!='"')return{};std::string out;for(size_t index=first+1;index<body.size();++index){char value=body[index];if(value=='"')return out;if(value=='\\'){if(++index>=body.size())break;value=body[index];if(value=='/'||value=='\\'||value=='"')out.push_back(value);else throw std::runtime_error("unsupported json escape");}else out.push_back(value);}throw std::runtime_error("invalid current.json");}
std::string jsonOptionalString(const std::string& body,const std::string& key){return jsonString(body,key);}
bool jsonUnsignedEquals(const std::string& body,const std::string& key,unsigned long long expected){const auto first=jsonValueStart(body,key);if(first==std::string::npos||first>=body.size()||body[first]<'0'||body[first]>'9')return false;size_t end=first;while(end<body.size()&&body[end]>='0'&&body[end]<='9')++end;const auto after=body.find_first_not_of(" \t\r\n",end);if(after==std::string::npos||(body[after]!=','&&body[after]!='}'))return false;try{return std::stoull(body.substr(first,end-first))==expected;}catch(...){return false;}}
bool jsonBoolean(const std::string& body,const std::string& key,bool fallback=false){const auto first=jsonValueStart(body,key);if(first==std::string::npos)return fallback;for(const auto& literal:std::vector<std::pair<std::string,bool>>{{"true",true},{"false",false}}){if(body.compare(first,literal.first.size(),literal.first)!=0)continue;const auto after=body.find_first_not_of(" \t\r\n",first+literal.first.size());if(after!=std::string::npos&&(body[after]==','||body[after]=='}'))return literal.second;}return fallback;}
std::wstring utf8(const std::string& value){if(value.empty())return{};int count=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,value.data(),static_cast<int>(value.size()),nullptr,0);if(count<=0)throw std::runtime_error("invalid utf8");std::wstring out(count,L'\0');MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,value.data(),static_cast<int>(value.size()),out.data(),count);return out;}
std::filesystem::path extendedPath(const std::filesystem::path& value);
bool safeRelative(const std::wstring& value){
  if(value.empty()||value.size()>4096||value.front()==L'/'||value.front()==L'\\'||value.find(L"//")!=std::wstring::npos||value.find(L':')!=std::wstring::npos||value.find(L'\\')!=std::wstring::npos)return false;const std::wregex reserved(LR"(^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9]|lpt[1-9])(?:\.|$))",std::regex_constants::icase);std::filesystem::path item(value);
  for(const auto& part:item){const auto segment=part.wstring();if(segment.empty()||segment==L"."||segment==L".."||segment.back()==L'.'||segment.back()==L' '||std::regex_search(segment,reserved))return false;for(const auto ch:segment)if(ch<32||ch==L'<'||ch==L'>'||ch==L'"'||ch==L'|'||ch==L'?'||ch==L'*')return false;}return !item.is_absolute();
}
std::string sha256(const std::filesystem::path& file){
  BCRYPT_ALG_HANDLE algorithm=nullptr;BCRYPT_HASH_HANDLE hash=nullptr;DWORD objectSize=0,resultSize=0;std::vector<unsigned char> object,digest(32),buffer(1024*1024);std::ifstream stream(file,std::ios::binary);if(!stream)throw std::runtime_error("payload file");
  if(BCryptOpenAlgorithmProvider(&algorithm,BCRYPT_SHA256_ALGORITHM,nullptr,0)!=0||BCryptGetProperty(algorithm,BCRYPT_OBJECT_LENGTH,reinterpret_cast<PUCHAR>(&objectSize),sizeof(objectSize),&resultSize,0)!=0)throw std::runtime_error("sha256 init");object.resize(objectSize);
  if(BCryptCreateHash(algorithm,&hash,object.data(),objectSize,nullptr,0,0)!=0)throw std::runtime_error("sha256 hash");
  try{while(stream){stream.read(reinterpret_cast<char*>(buffer.data()),static_cast<std::streamsize>(buffer.size()));const auto count=stream.gcount();if(count>0&&BCryptHashData(hash,buffer.data(),static_cast<ULONG>(count),0)!=0)throw std::runtime_error("sha256 data");}if(BCryptFinishHash(hash,digest.data(),static_cast<ULONG>(digest.size()),0)!=0)throw std::runtime_error("sha256 finish");}catch(...){BCryptDestroyHash(hash);BCryptCloseAlgorithmProvider(algorithm,0);throw;}
  BCryptDestroyHash(hash);BCryptCloseAlgorithmProvider(algorithm,0);const char hex[]="0123456789abcdef";std::string out;out.reserve(64);for(auto byte:digest){out.push_back(hex[byte>>4]);out.push_back(hex[byte&15]);}return out;
}
std::string extractHashed(std::ifstream& stream,HANDLE output,unsigned long long size,unsigned long long& position){
  BCRYPT_ALG_HANDLE algorithm=nullptr;BCRYPT_HASH_HANDLE hash=nullptr;DWORD objectSize=0,resultSize=0;std::vector<unsigned char> object,digest(32);std::vector<char> buffer(1024*1024);
  if(BCryptOpenAlgorithmProvider(&algorithm,BCRYPT_SHA256_ALGORITHM,nullptr,0)!=0||BCryptGetProperty(algorithm,BCRYPT_OBJECT_LENGTH,reinterpret_cast<PUCHAR>(&objectSize),sizeof(objectSize),&resultSize,0)!=0)throw std::runtime_error("extract hash init");object.resize(objectSize);
  if(BCryptCreateHash(algorithm,&hash,object.data(),objectSize,nullptr,0,0)!=0){BCryptCloseAlgorithmProvider(algorithm,0);throw std::runtime_error("extract hash");}
  try{stream.clear();stream.seekg(static_cast<std::streamoff>(position));unsigned long long remaining=size;while(remaining){const auto wanted=static_cast<std::streamsize>(std::min<unsigned long long>(remaining,buffer.size()));stream.read(buffer.data(),wanted);const auto count=stream.gcount();DWORD written=0;if(count<=0||!WriteFile(output,buffer.data(),static_cast<DWORD>(count),&written,nullptr)||written!=static_cast<DWORD>(count))throw std::runtime_error("container extract");if(BCryptHashData(hash,reinterpret_cast<PUCHAR>(buffer.data()),static_cast<ULONG>(count),0)!=0)throw std::runtime_error("extract hash data");remaining-=static_cast<unsigned long long>(count);position+=static_cast<unsigned long long>(count);}if(BCryptFinishHash(hash,digest.data(),static_cast<ULONG>(digest.size()),0)!=0)throw std::runtime_error("extract hash finish");}catch(...){BCryptDestroyHash(hash);BCryptCloseAlgorithmProvider(algorithm,0);throw;}
  BCryptDestroyHash(hash);BCryptCloseAlgorithmProvider(algorithm,0);const char hex[]="0123456789abcdef";std::string out;out.reserve(64);for(auto byte:digest){out.push_back(hex[byte>>4]);out.push_back(hex[byte&15]);}return out;
}
std::array<unsigned char,32> sha256Ranges(const std::filesystem::path& file,const std::vector<std::pair<unsigned long long,unsigned long long>>& ranges){
  BCRYPT_ALG_HANDLE algorithm=nullptr;BCRYPT_HASH_HANDLE hash=nullptr;DWORD objectSize=0,resultSize=0;std::vector<unsigned char> object,buffer(1024*1024);std::array<unsigned char,32> digest{};std::ifstream stream(file,std::ios::binary);if(!stream)throw std::runtime_error("container file");
  if(BCryptOpenAlgorithmProvider(&algorithm,BCRYPT_SHA256_ALGORITHM,nullptr,0)!=0||BCryptGetProperty(algorithm,BCRYPT_OBJECT_LENGTH,reinterpret_cast<PUCHAR>(&objectSize),sizeof(objectSize),&resultSize,0)!=0)throw std::runtime_error("container hash init");object.resize(objectSize);
  if(BCryptCreateHash(algorithm,&hash,object.data(),objectSize,nullptr,0,0)!=0){BCryptCloseAlgorithmProvider(algorithm,0);throw std::runtime_error("container hash");}
  try{for(const auto& range:ranges){stream.clear();stream.seekg(static_cast<std::streamoff>(range.first));unsigned long long remaining=range.second;while(remaining){const auto wanted=static_cast<std::streamsize>(std::min<unsigned long long>(remaining,buffer.size()));stream.read(reinterpret_cast<char*>(buffer.data()),wanted);const auto count=stream.gcount();if(count<=0)throw std::runtime_error("container range");if(BCryptHashData(hash,buffer.data(),static_cast<ULONG>(count),0)!=0)throw std::runtime_error("container hash data");remaining-=static_cast<unsigned long long>(count);}}if(BCryptFinishHash(hash,digest.data(),static_cast<ULONG>(digest.size()),0)!=0)throw std::runtime_error("container hash finish");}catch(...){BCryptDestroyHash(hash);BCryptCloseAlgorithmProvider(algorithm,0);throw;}
  BCryptDestroyHash(hash);BCryptCloseAlgorithmProvider(algorithm,0);return digest;
}
void verifyPayloadManifest(const std::string& manifest,const std::filesystem::path& payload,const std::string& version){
  if(jsonString(manifest,"version")!=version)throw std::runtime_error("payload version");
  const std::regex entry(R"json(\{\s*"path"\s*:\s*"([^"]+)"\s*,\s*"size"\s*:\s*([0-9]+)\s*,\s*"sha256"\s*:\s*"([a-f0-9]{64})"\s*\})json");size_t verified=0;
  for(std::sregex_iterator item(manifest.begin(),manifest.end(),entry),end;item!=end;++item){
    const auto relative=utf8((*item)[1].str());if(!safeRelative(relative)||relative.find(L'\\')!=std::wstring::npos)throw std::runtime_error("unsafe manifest path");
    const auto file=extendedPath(payload/std::filesystem::path(relative));const DWORD attributes=GetFileAttributesW(file.c_str());if(attributes==INVALID_FILE_ATTRIBUTES||(attributes&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT)))throw std::runtime_error("payload attributes");
    const auto wantedSize=std::stoull((*item)[2].str());if(std::filesystem::file_size(file)!=wantedSize||sha256(file)!=(*item)[3].str())throw std::runtime_error("payload hash");++verified;
  }
  size_t actual=0;for(const auto& item:std::filesystem::recursive_directory_iterator(extendedPath(payload))){const DWORD attributes=GetFileAttributesW(item.path().c_str());if(attributes!=INVALID_FILE_ATTRIBUTES&&(attributes&FILE_ATTRIBUTE_REPARSE_POINT))throw std::runtime_error("payload reparse");if(item.is_regular_file())++actual;}
  if(!verified||verified!=actual)throw std::runtime_error("payload file count");
}
void verifyPayload(const std::filesystem::path& base,const std::filesystem::path& payload,const std::string& version){verifyPayloadManifest(readBytes(base/L"payload-manifest.json"),payload,version);}
std::wstring quote(const std::wstring& value){std::wstring out=L"\"";unsigned slashes=0;for(wchar_t ch:value){if(ch==L'\\'){++slashes;continue;}if(ch==L'"'){out.append(slashes*2+1,L'\\');out.push_back(ch);slashes=0;continue;}out.append(slashes,L'\\');slashes=0;out.push_back(ch);}out.append(slashes*2,L'\\');out.push_back(L'"');return out;}
std::wstring randomToken(){unsigned char bytes[32];if(BCryptGenRandom(nullptr,bytes,sizeof(bytes),BCRYPT_USE_SYSTEM_PREFERRED_RNG)!=0)throw std::runtime_error("random");const wchar_t hex[]=L"0123456789abcdef";std::wstring out;out.reserve(64);for(auto byte:bytes){out.push_back(hex[byte>>4]);out.push_back(hex[byte&15]);}SecureZeroMemory(bytes,sizeof(bytes));return out;}
// Win32 rather than the CRT environment copy so the launcher keeps depending on
// documented Win32 APIs only.
std::wstring environmentVariable(const wchar_t* name){std::vector<wchar_t> buffer(512);for(;;){SetLastError(ERROR_SUCCESS);const DWORD size=GetEnvironmentVariableW(name,buffer.data(),static_cast<DWORD>(buffer.size()));if(!size)return{};if(size<buffer.size())return std::wstring(buffer.data(),size);buffer.assign(size+1,L'\0');}}
std::wstring localDataRoot(){const auto root=environmentVariable(L"LOCALAPPDATA");if(root.empty())throw std::runtime_error("LOCALAPPDATA");return(std::filesystem::path(root)/L"Claudex Workhouse").wstring();}
// An extended-length path turns off every Win32 path fixup, including the
// forward-slash rewrite, so a `payload/1.0.0` component read out of current.json
// or payload-manifest.json has to be converted here. std::filesystem::absolute
// normalises separators through GetFullPathNameW on some toolchains and not on
// others, so the launcher never relies on it doing so.
std::filesystem::path extendedPath(const std::filesystem::path& value){auto absolute=std::filesystem::absolute(value).wstring();for(auto& character:absolute)if(character==L'/')character=L'\\';if(absolute.rfind(L"\\\\?\\",0)==0)return absolute;if(absolute.rfind(L"\\\\",0)==0)return L"\\\\?\\UNC\\"+absolute.substr(2);return L"\\\\?\\"+absolute;}
// Attribute probes that answer only what the launcher asked, with no CRT, no
// stream and no exception path.
bool win32Directory(const std::wstring& value){const DWORD attributes=GetFileAttributesW(value.c_str());return attributes!=INVALID_FILE_ATTRIBUTES&&(attributes&FILE_ATTRIBUTE_DIRECTORY)!=0&&(attributes&FILE_ATTRIBUTE_REPARSE_POINT)==0;}
bool win32RegularFile(const std::wstring& value){const DWORD attributes=GetFileAttributesW(value.c_str());return attributes!=INVALID_FILE_ATTRIBUTES&&(attributes&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT))==0;}
std::string narrow(const std::wstring& value){if(value.empty())return{};const int count=WideCharToMultiByte(CP_UTF8,0,value.data(),static_cast<int>(value.size()),nullptr,0,nullptr,nullptr);if(count<=0)return{};std::string out(static_cast<size_t>(count),'\0');WideCharToMultiByte(CP_UTF8,0,value.data(),static_cast<int>(value.size()),out.data(),count,nullptr,nullptr);return out;}
std::filesystem::path defaultInstallRoot(){return std::filesystem::path(localDataRoot())/L"server";}
bool validInstallRoot(const std::filesystem::path& value){
  if(value.empty()||!value.is_absolute()||value==value.root_path()||value.wstring().rfind(L"\\\\?\\",0)==0||value.wstring().find(L'%')!=std::wstring::npos)return false;
  for(auto current=value;;current=current.parent_path()){const DWORD attributes=GetFileAttributesW(extendedPath(current).c_str());if(attributes!=INVALID_FILE_ATTRIBUTES){if((attributes&FILE_ATTRIBUTE_DIRECTORY)==0||(attributes&FILE_ATTRIBUTE_REPARSE_POINT)!=0)return false;}else{const DWORD error=GetLastError();if(error!=ERROR_FILE_NOT_FOUND&&error!=ERROR_PATH_NOT_FOUND)return false;}const auto parent=current.parent_path();if(parent.empty()||parent==current)break;}return true;
}
std::wstring comparablePath(const std::filesystem::path& value){auto out=std::filesystem::absolute(value).lexically_normal().wstring();while(out.size()>3&&(out.back()==L'\\'||out.back()==L'/'))out.pop_back();for(auto& ch:out){if(ch==L'/')ch=L'\\';else ch=static_cast<wchar_t>(towlower(ch));}return out;}
bool pathContains(const std::filesystem::path& parent,const std::filesystem::path& child){const auto base=comparablePath(parent),candidate=comparablePath(child);return candidate==base||(candidate.size()>base.size()&&candidate.compare(0,base.size(),base)==0&&candidate[base.size()]==L'\\');}
std::filesystem::path loadInstallRoot(){
  wchar_t value[32768]={};DWORD size=sizeof(value);if(RegGetValueW(HKEY_CURRENT_USER,L"Software\\Claudex Workhouse",L"InstallRoot",RRF_RT_REG_SZ,nullptr,value,&size)==ERROR_SUCCESS){const std::filesystem::path stored(value);if(validInstallRoot(stored))return stored;}
  return defaultInstallRoot();
}
bool registeredInstallRoot(const std::filesystem::path& value){wchar_t stored[32768]={};DWORD size=sizeof(stored);return RegGetValueW(HKEY_CURRENT_USER,L"Software\\Claudex Workhouse",L"InstallRoot",RRF_RT_REG_SZ,nullptr,stored,&size)==ERROR_SUCCESS&&comparablePath(stored)==comparablePath(value);}
void persistInstallRoot(const std::filesystem::path& value){HKEY key=nullptr;if(RegCreateKeyExW(HKEY_CURRENT_USER,L"Software\\Claudex Workhouse",0,nullptr,0,KEY_SET_VALUE,nullptr,&key,nullptr)!=ERROR_SUCCESS)return;const auto stored=value.wstring();RegSetValueExW(key,L"InstallRoot",0,REG_SZ,reinterpret_cast<const BYTE*>(stored.c_str()),static_cast<DWORD>((stored.size()+1)*sizeof(wchar_t)));RegCloseKey(key);}
unsigned long long little64(const unsigned char* value){unsigned long long out=0;for(int index=7;index>=0;--index)out=(out<<8)|value[index];return out;}
unsigned long little32(const unsigned char* value){unsigned long out=0;for(int index=3;index>=0;--index)out=(out<<8)|value[index];return out;}
void atomicBytes(const std::filesystem::path& file,const std::string& body){
  std::filesystem::create_directories(extendedPath(file.parent_path()));const auto target=extendedPath(file).wstring();const auto temporary=target+L"."+std::to_wstring(GetCurrentProcessId())+L"."+randomToken().substr(0,16)+L".tmp";HANDLE handle=CreateFileW(temporary.c_str(),GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr);if(handle==INVALID_HANDLE_VALUE)throw std::runtime_error("atomic create");
  try{DWORD written=0;if(body.size()>MAXDWORD||!WriteFile(handle,body.data(),static_cast<DWORD>(body.size()),&written,nullptr)||written!=static_cast<DWORD>(body.size())||!FlushFileBuffers(handle))throw std::runtime_error("atomic write");CloseHandle(handle);handle=INVALID_HANDLE_VALUE;if(!MoveFileExW(temporary.c_str(),target.c_str(),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH))throw std::runtime_error("atomic rename");}catch(...){if(handle!=INVALID_HANDLE_VALUE)CloseHandle(handle);DeleteFileW(temporary.c_str());throw;}
}
constexpr wchar_t kProductRegistry[]=L"Software\\Claudex Workhouse";
constexpr wchar_t kUninstallRegistry[]=L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Claudex Workhouse";
std::filesystem::path installedLauncher(const std::filesystem::path& root){return root/L"Claudex Workhouse.exe";}
void registryString(HKEY key,const wchar_t* name,const std::wstring& value){RegSetValueExW(key,name,0,REG_SZ,reinterpret_cast<const BYTE*>(value.c_str()),static_cast<DWORD>((value.size()+1)*sizeof(wchar_t)));}
void copyInstalledLauncher(const std::filesystem::path& root){
  const auto source=executablePath(),target=installedLauncher(root);if(!_wcsicmp(std::filesystem::absolute(source).c_str(),std::filesystem::absolute(target).c_str()))return;const auto temporary=target.wstring()+L"."+std::to_wstring(GetCurrentProcessId())+L"."+randomToken().substr(0,16)+L".tmp";if(!g_embeddedLauncherSize)throw std::runtime_error("launcher size");std::ifstream input(source,std::ios::binary);if(!input)throw std::runtime_error("launcher copy");HANDLE launcherOutput=CreateFileW(extendedPath(temporary).c_str(),GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr);if(launcherOutput==INVALID_HANDLE_VALUE)throw std::runtime_error("launcher copy");
  try{std::vector<char> buffer(1024*1024);unsigned long long remaining=g_embeddedLauncherSize;while(remaining){const auto wanted=static_cast<std::streamsize>(std::min<unsigned long long>(remaining,buffer.size()));input.read(buffer.data(),wanted);const auto count=input.gcount();DWORD written=0;if(count<=0||!WriteFile(launcherOutput,buffer.data(),static_cast<DWORD>(count),&written,nullptr)||written!=static_cast<DWORD>(count))throw std::runtime_error("launcher write");remaining-=static_cast<unsigned long long>(count);}if(!FlushFileBuffers(launcherOutput))throw std::runtime_error("launcher flush");CloseHandle(launcherOutput);launcherOutput=INVALID_HANDLE_VALUE;if(!MoveFileExW(extendedPath(temporary).c_str(),extendedPath(target).c_str(),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH))throw std::runtime_error("launcher activate");}catch(...){if(launcherOutput!=INVALID_HANDLE_VALUE)CloseHandle(launcherOutput);DeleteFileW(extendedPath(temporary).c_str());throw;}
}
std::filesystem::path knownFolder(REFKNOWNFOLDERID id){PWSTR value=nullptr;if(FAILED(SHGetKnownFolderPath(id,KF_FLAG_CREATE,nullptr,&value))||!value)throw std::runtime_error("known folder");std::filesystem::path out(value);CoTaskMemFree(value);return out;}
void createShortcut(const std::filesystem::path& link,const std::filesystem::path& target,const std::filesystem::path& working){
  IShellLinkW* shortcut=nullptr;IPersistFile* persisted=nullptr;if(FAILED(CoCreateInstance(CLSID_ShellLink,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&shortcut)))||!shortcut)throw std::runtime_error("shortcut create");
  const auto description=std::wstring(L"Claudex Workhouse");HRESULT result=shortcut->SetPath(target.c_str());if(SUCCEEDED(result))result=shortcut->SetWorkingDirectory(working.c_str());if(SUCCEEDED(result))result=shortcut->SetDescription(description.c_str());if(SUCCEEDED(result))result=shortcut->SetIconLocation(target.c_str(),0);if(SUCCEEDED(result))result=shortcut->QueryInterface(IID_PPV_ARGS(&persisted));if(SUCCEEDED(result)){std::filesystem::create_directories(link.parent_path());result=persisted->Save(link.c_str(),TRUE);}if(persisted)persisted->Release();shortcut->Release();if(FAILED(result))throw std::runtime_error("shortcut save");
}
void removeShortcutFiles(){
  const HRESULT initialized=CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED);try{const auto startGroup=knownFolder(FOLDERID_Programs)/L"Claudex Workhouse";DeleteFileW((startGroup/L"Claudex Workhouse.lnk").c_str());RemoveDirectoryW(startGroup.c_str());DeleteFileW((knownFolder(FOLDERID_Desktop)/L"Claudex Workhouse.lnk").c_str());}catch(...){}if(SUCCEEDED(initialized))CoUninitialize();
}
void registerInstalledApplication(const std::filesystem::path& root,const std::string& version){
  copyInstalledLauncher(root);const auto launcher=installedLauncher(root);const HRESULT initialized=CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED);try{createShortcut(knownFolder(FOLDERID_Programs)/L"Claudex Workhouse"/L"Claudex Workhouse.lnk",launcher,root);createShortcut(knownFolder(FOLDERID_Desktop)/L"Claudex Workhouse.lnk",launcher,root);}catch(...){if(SUCCEEDED(initialized))CoUninitialize();throw;}if(SUCCEEDED(initialized))CoUninitialize();
  HKEY key=nullptr;if(RegCreateKeyExW(HKEY_CURRENT_USER,kUninstallRegistry,0,nullptr,0,KEY_SET_VALUE,nullptr,&key,nullptr)!=ERROR_SUCCESS)throw std::runtime_error("uninstall registration");const DWORD one=1;registryString(key,L"DisplayName",L"Claudex Workhouse");registryString(key,L"DisplayVersion",utf8(version));registryString(key,L"Publisher",L"Claudex Workhouse");registryString(key,L"InstallLocation",root.wstring());registryString(key,L"DisplayIcon",launcher.wstring()+L",0");registryString(key,L"UninstallString",quote(launcher.wstring())+L" --uninstall");RegSetValueExW(key,L"NoModify",0,REG_DWORD,reinterpret_cast<const BYTE*>(&one),sizeof(one));RegSetValueExW(key,L"NoRepair",0,REG_DWORD,reinterpret_cast<const BYTE*>(&one),sizeof(one));RegCloseKey(key);
}
void storeServerPid(DWORD pid){HKEY key=nullptr;if(RegCreateKeyExW(HKEY_CURRENT_USER,kProductRegistry,0,nullptr,0,KEY_SET_VALUE,nullptr,&key,nullptr)==ERROR_SUCCESS){RegSetValueExW(key,L"ServerPid",0,REG_DWORD,reinterpret_cast<const BYTE*>(&pid),sizeof(pid));RegCloseKey(key);}}
void stopInstalledServer(const std::filesystem::path& root){
  DWORD pid=0,size=sizeof(pid);if(RegGetValueW(HKEY_CURRENT_USER,kProductRegistry,L"ServerPid",RRF_RT_REG_DWORD,nullptr,&pid,&size)!=ERROR_SUCCESS||!pid)return;HANDLE process=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|PROCESS_TERMINATE|SYNCHRONIZE,FALSE,pid);if(!process)return;std::vector<wchar_t> image(32768);DWORD length=static_cast<DWORD>(image.size());if(QueryFullProcessImageNameW(process,0,image.data(),&length)){std::filesystem::path expected;try{const auto current=readBytes(extendedPath(root/L"current.json"));const auto relative=utf8(jsonString(current,"payloadDirectory"));if(safeRelative(relative))expected=root/relative/L"node.exe";}catch(...){}if(!expected.empty()&&!_wcsicmp(std::filesystem::absolute(expected).c_str(),std::filesystem::absolute(std::filesystem::path(std::wstring(image.data(),length))).c_str())){TerminateProcess(process,0);WaitForSingleObject(process,10000);}}CloseHandle(process);
}
bool scheduleInstallRemoval(const std::filesystem::path& root){
  const auto script=std::filesystem::path(localDataRoot())/L"runtime"/(L"uninstall-"+std::to_wstring(GetCurrentProcessId())+L".cmd");atomicBytes(script,"@echo off\r\n:wait\r\ntasklist /FI \"PID eq %~2\" /NH | findstr /C:\"%~2\" >nul\r\nif not errorlevel 1 (timeout /t 1 /nobreak >nul & goto wait)\r\nrmdir /s /q \"%~1\"\r\ndel /q \"%~f0\"\r\n");wchar_t system[MAX_PATH]={};if(!GetSystemDirectoryW(system,MAX_PATH))return false;const auto command=quote((std::filesystem::path(system)/L"cmd.exe").wstring())+L" /d /q /c \"\""+script.wstring()+L"\" \""+root.wstring()+L"\" \""+std::to_wstring(GetCurrentProcessId())+L"\"\"";STARTUPINFOW startup{};startup.cb=sizeof(startup);PROCESS_INFORMATION process{};std::vector<wchar_t> mutableCommand(command.begin(),command.end());mutableCommand.push_back(L'\0');if(!CreateProcessW(nullptr,mutableCommand.data(),nullptr,nullptr,FALSE,CREATE_NO_WINDOW,nullptr,nullptr,&startup,&process))return false;CloseHandle(process.hThread);CloseHandle(process.hProcess);return true;
}
bool verifiedInstalledRoot(const std::filesystem::path& root){
  try{if(pathContains(root,localDataRoot()))return false;const auto launcher=installedLauncher(root),currentFile=root/L"current.json";const DWORD launcherAttributes=GetFileAttributesW(extendedPath(launcher).c_str());if(launcherAttributes==INVALID_FILE_ATTRIBUTES||(launcherAttributes&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT)))return false;const auto current=readBytes(extendedPath(currentFile));const auto relative=utf8(jsonString(current,"payloadDirectory"));if(!safeRelative(relative))return false;const auto node=root/relative/L"node.exe";const DWORD nodeAttributes=GetFileAttributesW(extendedPath(node).c_str());return nodeAttributes!=INVALID_FILE_ATTRIBUTES&&(nodeAttributes&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT))==0;}catch(...){return false;}
}
bool installedStatusLauncher(){
  try{const auto root=loadInstallRoot();return registeredInstallRoot(root)&&verifiedInstalledRoot(root)&&comparablePath(executablePath())==comparablePath(installedLauncher(root));}catch(...){return false;}
}
int uninstallApplication(){
  const auto root=loadInstallRoot();if(!verifiedInstalledRoot(root)){if(!g_quietUninstall)MessageBoxW(nullptr,text(Text::UninstallFailed),text(Text::WindowTitle),MB_OK|MB_ICONERROR);return 1;}if(!g_quietUninstall&&MessageBoxW(nullptr,text(Text::UninstallConfirm),text(Text::WindowTitle),MB_YESNO|MB_ICONWARNING|MB_DEFBUTTON2)!=IDYES)return 0;stopInstalledServer(root);if(!scheduleInstallRemoval(root)){if(!g_quietUninstall)MessageBoxW(nullptr,text(Text::UninstallFailed),text(Text::WindowTitle),MB_OK|MB_ICONERROR);return 1;}removeShortcutFiles();RegDeleteTreeW(HKEY_CURRENT_USER,kUninstallRegistry);RegDeleteKeyValueW(HKEY_CURRENT_USER,kProductRegistry,L"InstallRoot");RegDeleteKeyValueW(HKEY_CURRENT_USER,kProductRegistry,L"ServerPid");if(!g_quietUninstall)MessageBoxW(nullptr,text(Text::UninstallComplete),text(Text::WindowTitle),MB_OK|MB_ICONINFORMATION);return 0;
}
constexpr size_t kFooterSize=112;
// Locates the appended single-EXE payload container. Returns false when this
// launcher carries no container, which is what the portable folder form and the
// installed status launcher both look like on disk.
bool readContainerFooter(std::ifstream& stream,IMAGE_DOS_HEADER& dos,unsigned long long& logicalEnd,std::array<unsigned char,kFooterSize>& footer){
  const std::array<unsigned char,16> magic={'C','W','H','S','P','A','Y','L','O','A','D','V','2',0,0,0};stream.seekg(0,std::ios::end);const auto total=static_cast<unsigned long long>(stream.tellg());if(total<kFooterSize)return false;
  stream.clear();stream.seekg(0);stream.read(reinterpret_cast<char*>(&dos),sizeof(dos));if(!stream||dos.e_magic!=IMAGE_DOS_SIGNATURE)return false;IMAGE_NT_HEADERS64 nt{};stream.clear();stream.seekg(dos.e_lfanew);stream.read(reinterpret_cast<char*>(&nt),sizeof(nt));if(!stream||nt.Signature!=IMAGE_NT_SIGNATURE||nt.FileHeader.SizeOfOptionalHeader<152||nt.OptionalHeader.Magic!=IMAGE_NT_OPTIONAL_HDR64_MAGIC||nt.OptionalHeader.NumberOfRvaAndSizes<5)throw std::runtime_error("container pe");
  const auto certificate=nt.OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_SECURITY];logicalEnd=total;if(certificate.VirtualAddress||certificate.Size){if(!certificate.VirtualAddress||!certificate.Size||certificate.VirtualAddress%8||static_cast<unsigned long long>(certificate.VirtualAddress)+certificate.Size!=total)throw std::runtime_error("container certificate");logicalEnd=certificate.VirtualAddress;}if(logicalEnd<kFooterSize)return false;
  stream.clear();stream.seekg(static_cast<std::streamoff>(logicalEnd-kFooterSize));stream.read(reinterpret_cast<char*>(footer.data()),footer.size());return static_cast<bool>(stream)&&std::equal(magic.begin(),magic.end(),footer.begin());
}
bool readAt(HANDLE handle,unsigned long long offset,void* buffer,DWORD size){LARGE_INTEGER position{};position.QuadPart=static_cast<LONGLONG>(offset);if(!SetFilePointerEx(handle,position,nullptr,FILE_BEGIN))return false;DWORD read=0;return ReadFile(handle,buffer,size,&read,nullptr)!=0&&read==size;}
/** Does this launcher carry an appended payload container?
 *
 * This single answer decides installation wizard versus direct start, so it is
 * pure Win32: no stream, no std::filesystem, no CRT locale, no exception path.
 * Anything it cannot read answers "no", because a launcher that cannot prove it
 * has something to install must never ask the user to install it. The strict
 * container parsing, including every hash, still happens in
 * prepareEmbeddedPayload() before a single byte is extracted. */
bool embeddedPayloadPresent(){
  const std::array<unsigned char,16> magic={'C','W','H','S','P','A','Y','L','O','A','D','V','2',0,0,0};
  std::vector<wchar_t> image(32768);const DWORD length=GetModuleFileNameW(nullptr,image.data(),static_cast<DWORD>(image.size()));
  if(!length||length>=image.size())return false;
  HANDLE handle=CreateFileW(image.data(),GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,nullptr,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,nullptr);
  if(handle==INVALID_HANDLE_VALUE)return false;
  bool present=false;LARGE_INTEGER size{};IMAGE_DOS_HEADER dos{};IMAGE_NT_HEADERS64 nt{};std::array<unsigned char,kFooterSize> footer{};
  if(GetFileSizeEx(handle,&size)&&size.QuadPart>static_cast<LONGLONG>(kFooterSize)&&readAt(handle,0,&dos,sizeof(dos))&&dos.e_magic==IMAGE_DOS_SIGNATURE&&dos.e_lfanew>0&&readAt(handle,static_cast<unsigned long long>(dos.e_lfanew),&nt,sizeof(nt))&&nt.Signature==IMAGE_NT_SIGNATURE&&nt.OptionalHeader.Magic==IMAGE_NT_OPTIONAL_HDR64_MAGIC&&nt.OptionalHeader.NumberOfRvaAndSizes>=5){
    const auto certificate=nt.OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_SECURITY];auto end=static_cast<unsigned long long>(size.QuadPart);
    if(certificate.VirtualAddress&&certificate.Size&&static_cast<unsigned long long>(certificate.VirtualAddress)+certificate.Size==end)end=certificate.VirtualAddress;
    if(end>=kFooterSize&&readAt(handle,end-kFooterSize,footer.data(),static_cast<DWORD>(footer.size())))present=std::equal(magic.begin(),magic.end(),footer.begin());
  }
  CloseHandle(handle);return present;
}
/** Everything the launcher knows about how it decided what it is, as one ASCII
 * line for the error log and the diagnostics file. A portable start that fails
 * has to be identifiable as a portable start: the previous build answered a
 * failed structural probe with the installation wizard, which made a runtime
 * fault look like a product decision. Nothing here changes the mode. */
std::string describeLauncherLayout(bool embedded){
  std::string out;
  try{
    const auto base=executablePath().parent_path().wstring();
    out+="base="+narrow(base);
    out+=" embeddedPayload=";out+=embedded?"yes":"no";
    for(const auto* name:{L"current.json",L"payload-manifest.json"}){
      const auto plain=base+L"\\"+name;
      out+=" "+narrow(name)+"=";out+=win32RegularFile(plain)?"yes":"no";
      out+="/ext=";out+=win32RegularFile(extendedPath(plain).wstring())?"yes":"no";
    }
    std::wstring relative;
    try{relative=utf8(jsonString(readBytes(extendedPath(base+L"\\current.json")),"payloadDirectory"));}catch(const std::exception& error){out+=" currentJson="+std::string(error.what());}
    if(!relative.empty()){
      out+=" payloadDirectory="+narrow(relative);
      out+=" safeRelative=";out+=safeRelative(relative)?"yes":"no";
      auto payload=relative;for(auto& character:payload)if(character==L'/')character=L'\\';
      const auto root=base+L"\\"+payload;
      out+=" payloadDir=";out+=win32Directory(extendedPath(root).wstring())?"yes":"no";
      out+=" node.exe=";out+=win32RegularFile(extendedPath(root+L"\\node.exe").wstring())?"yes":"no";
      out+=" app/start.mjs=";out+=win32RegularFile(extendedPath(root+L"\\app\\start.mjs").wstring())?"yes":"no";
    }
  }catch(const std::exception& error){out+=" layout="+std::string(error.what());}
  catch(...){out+=" layout=unknown";}
  return out;
}
std::filesystem::path prepareEmbeddedPayload(std::string& embeddedManifest,std::filesystem::path& embeddedTarget){
  constexpr size_t footerSize=kFooterSize;const auto executable=executablePath();std::ifstream stream(executable,std::ios::binary);if(!stream)throw std::runtime_error("container open");
  IMAGE_DOS_HEADER dos{};unsigned long long logicalEnd=0;std::array<unsigned char,footerSize> footer{};if(!readContainerFooter(stream,dos,logicalEnd,footer))return executable.parent_path();
  if(little32(footer.data()+16)!=2||little32(footer.data()+20)!=footerSize)throw std::runtime_error("container footer");
  const auto launcherSize=little64(footer.data()+24),payloadSize=little64(footer.data()+32),manifestSize=little64(footer.data()+40);if(!launcherSize||!payloadSize||!manifestSize||launcherSize+payloadSize+manifestSize+footerSize!=logicalEnd||manifestSize>16*1024*1024)throw std::runtime_error("container sizes");g_embeddedLauncherSize=launcherSize;
  const auto optional=static_cast<unsigned long long>(dos.e_lfanew)+sizeof(DWORD)+sizeof(IMAGE_FILE_HEADER),checksum=optional+64,security=optional+144;if(security+8>launcherSize)throw std::runtime_error("container launcher");
  const auto launcherHash=sha256Ranges(executable,{{0,checksum},{checksum+4,security-(checksum+4)},{security+8,launcherSize-(security+8)}});if(!std::equal(launcherHash.begin(),launcherHash.end(),footer.begin()+48))throw std::runtime_error("container launcher hash");
  std::string manifest(static_cast<size_t>(manifestSize),'\0');stream.clear();stream.seekg(static_cast<std::streamoff>(launcherSize+payloadSize));stream.read(manifest.data(),static_cast<std::streamsize>(manifest.size()));if(!stream)throw std::runtime_error("container manifest");const auto manifestHash=sha256Ranges(executable,{{launcherSize+payloadSize,manifestSize}});if(!std::equal(manifestHash.begin(),manifestHash.end(),footer.begin()+80))throw std::runtime_error("container manifest hash");
  const auto version=jsonString(manifest,"version");if(jsonString(manifest,"product")!="claudex-workhouse-windows-server"||jsonString(manifest,"architecture")!="x64"||!jsonUnsignedEquals(manifest,"schemaVersion",1)||!std::regex_match(version,std::regex(R"(^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$)")))throw std::runtime_error("container identity");
  const auto install=g_requestedInstallRoot.empty()?defaultInstallRoot():g_requestedInstallRoot,versions=install/L"versions",target=versions/utf8(version);std::filesystem::create_directories(extendedPath(versions));
  const std::regex entry(R"json(\{\s*"path"\s*:\s*"([^"]+)"\s*,\s*"size"\s*:\s*([0-9]+)\s*,\s*"sha256"\s*:\s*"([a-f0-9]{64})"\s*\})json");std::vector<std::tuple<std::wstring,unsigned long long,std::string>> files;std::set<std::wstring> seen;unsigned long long declared=0;
  for(std::sregex_iterator item(manifest.begin(),manifest.end(),entry),end;item!=end;++item){const auto relative=utf8((*item)[1].str());if(!safeRelative(relative)||relative.find(L'\\')!=std::wstring::npos)throw std::runtime_error("container path");auto key=relative;for(auto& ch:key)ch=static_cast<wchar_t>(towlower(ch));if(!seen.insert(key).second)throw std::runtime_error("container collision");const auto size=std::stoull((*item)[2].str());declared+=size;if(declared>payloadSize)throw std::runtime_error("container declared size");files.emplace_back(relative,size,(*item)[3].str());}
  if(files.empty()||declared!=payloadSize||!seen.count(L"node.exe")||!seen.count(L"app/start.mjs"))throw std::runtime_error("container files");
  bool targetReady=false;const auto targetPath=extendedPath(target);const DWORD targetAttributes=GetFileAttributesW(targetPath.c_str());if(targetAttributes!=INVALID_FILE_ATTRIBUTES){if((targetAttributes&FILE_ATTRIBUTE_DIRECTORY)==0||(targetAttributes&FILE_ATTRIBUTE_REPARSE_POINT))throw std::runtime_error("container target");try{verifyPayloadManifest(manifest,target,version);targetReady=true;}catch(...){}
  }else{const DWORD error=GetLastError();if(error!=ERROR_FILE_NOT_FOUND&&error!=ERROR_PATH_NOT_FOUND)throw std::runtime_error("container target");}
  if(!targetReady){
    const auto staging=install/(L"staging-"+std::to_wstring(GetCurrentProcessId())+L"-"+randomToken().substr(0,16));if(!CreateDirectoryW(extendedPath(staging).c_str(),nullptr))throw std::runtime_error("container staging");
    std::filesystem::path replaced;try{unsigned long long position=launcherSize;for(const auto& item:files){const auto relative=std::get<0>(item);const auto size=std::get<1>(item);const auto file=staging/relative,win32File=extendedPath(file);std::filesystem::create_directories(extendedPath(file.parent_path()));HANDLE output=CreateFileW(win32File.c_str(),GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr);if(output==INVALID_HANDLE_VALUE)throw std::runtime_error("container output");try{if(extractHashed(stream,output,size,position)!=std::get<2>(item))throw std::runtime_error("container file hash");CloseHandle(output);output=INVALID_HANDLE_VALUE;}catch(...){if(output!=INVALID_HANDLE_VALUE)CloseHandle(output);throw;}}if(position!=launcherSize+payloadSize)throw std::runtime_error("container position");if(targetAttributes!=INVALID_FILE_ATTRIBUTES){replaced=install/(L"replaced-"+std::to_wstring(GetCurrentProcessId())+L"-"+randomToken().substr(0,16));if(!MoveFileExW(targetPath.c_str(),extendedPath(replaced).c_str(),MOVEFILE_WRITE_THROUGH))throw std::runtime_error("container replace");}if(!MoveFileExW(extendedPath(staging).c_str(),targetPath.c_str(),MOVEFILE_WRITE_THROUGH)){if(!replaced.empty())MoveFileExW(extendedPath(replaced).c_str(),targetPath.c_str(),MOVEFILE_WRITE_THROUGH);throw std::runtime_error("container activate");}if(!replaced.empty()){std::error_code ignored;std::filesystem::remove_all(extendedPath(replaced),ignored);}}catch(...){std::error_code ignored;std::filesystem::remove_all(extendedPath(staging),ignored);throw;}
  }
  embeddedManifest=manifest;embeddedTarget=target;std::string previous;const auto current=install/L"current.json";if(std::filesystem::exists(extendedPath(current))){try{previous=jsonString(readBytes(extendedPath(current)),"version");if(!std::regex_match(previous,std::regex(R"(^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$)")))previous.clear();}catch(...){}}
  const auto currentBody=std::string("{\"schemaVersion\":1,\"version\":\"")+version+"\",\"payloadDirectory\":\"versions/"+version+"\",\"previousVersion\":"+(previous.empty()?"null":"\""+previous+"\"")+"}\n";atomicBytes(install/L"payload-manifest.json",manifest);atomicBytes(current,currentBody);persistInstallRoot(install);registerInstalledApplication(install,version);return install;
}

std::string httpGet(const wchar_t* path){
  HINTERNET session=WinHttpOpen(L"Claudex Workhouse Launcher/1",WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,WINHTTP_NO_PROXY_NAME,WINHTTP_NO_PROXY_BYPASS,0);if(!session)return{};
  WinHttpSetTimeouts(session,1500,1500,1500,2500);HINTERNET connection=WinHttpConnect(session,L"127.0.0.1",3410,0),request=connection?WinHttpOpenRequest(connection,L"GET",path,nullptr,WINHTTP_NO_REFERER,WINHTTP_DEFAULT_ACCEPT_TYPES,0):nullptr;std::string body;
  if(request&&WinHttpSendRequest(request,WINHTTP_NO_ADDITIONAL_HEADERS,0,WINHTTP_NO_REQUEST_DATA,0,0,0)&&WinHttpReceiveResponse(request,nullptr)){DWORD status=0,size=sizeof(status);WinHttpQueryHeaders(request,WINHTTP_QUERY_STATUS_CODE|WINHTTP_QUERY_FLAG_NUMBER,nullptr,&status,&size,nullptr);if(status==200)for(;;){DWORD available=0;if(!WinHttpQueryDataAvailable(request,&available)||!available)break;std::vector<char> chunk(available);DWORD read=0;if(!WinHttpReadData(request,chunk.data(),available,&read))break;body.append(chunk.data(),read);if(body.size()>1024*1024){body.clear();break;}}}
  if(request)WinHttpCloseHandle(request);if(connection)WinHttpCloseHandle(connection);WinHttpCloseHandle(session);return body;
}
bool startServer();
void showControl(HWND control,bool visible){if(control)ShowWindow(control,visible?SW_SHOW:SW_HIDE);}
void setButton(HWND control,const wchar_t* caption,bool enabled){if(control){SetWindowTextW(control,caption);EnableWindow(control,enabled);InvalidateRect(control,nullptr,TRUE);}}
void setProgress(bool running){if(!g_progress)return;SendMessageW(g_progress,PBM_SETMARQUEE,running?TRUE:FALSE,30);showControl(g_progress,running);}

// Locale resolution order: --lang= flag, CLAUDEX_WORKHOUSE_LOCALE, the choice
// the user last made in this window, the Windows UI language, then English.
std::filesystem::path localePreferenceFile(){return std::filesystem::path(localDataRoot())/L"launcher-locale";}
bool parseLocale(const std::wstring& value,Locale& out){for(size_t index=0;index<kLocaleCount;++index)if(value==kLocaleTags[index]){out=static_cast<Locale>(index);return true;}return false;}
std::wstring environmentValue(const wchar_t* name){return environmentVariable(name);}
Locale detectLocale(const std::wstring& commandLine){
  Locale resolved=Locale::En;const auto flag=commandLine.find(L"--lang=");
  if(flag!=std::wstring::npos){auto rest=commandLine.substr(flag+7);rest=rest.substr(0,rest.find_first_of(L" \t\""));if(parseLocale(rest,resolved))return resolved;}
  if(parseLocale(environmentValue(L"CLAUDEX_WORKHOUSE_LOCALE"),resolved))return resolved;
  try{auto stored=utf8(readBytes(localePreferenceFile()));while(!stored.empty()&&(stored.back()==L'\n'||stored.back()==L'\r'||stored.back()==L' '))stored.pop_back();if(parseLocale(stored,resolved))return resolved;}catch(...){}
  ULONG count=0,size=0;
  if(GetUserPreferredUILanguages(MUI_LANGUAGE_NAME,&count,nullptr,&size)!=0&&size>0){std::vector<wchar_t> buffer(size);
    if(GetUserPreferredUILanguages(MUI_LANGUAGE_NAME,&count,buffer.data(),&size)!=0)for(const wchar_t* item=buffer.data();*item;item+=wcslen(item)+1){std::wstring tag(item);for(auto& ch:tag)ch=static_cast<wchar_t>(towlower(ch));if(tag.rfind(L"ko",0)==0)return Locale::Ko;if(tag.rfind(L"ja",0)==0)return Locale::Ja;if(tag.rfind(L"en",0)==0)return Locale::En;}}
  return Locale::En;
}
void persistLocale(){try{const char* const ascii[kLocaleCount]={"en","ko","ja"};atomicBytes(localePreferenceFile(),std::string(ascii[static_cast<size_t>(g_locale)])+"\n");}catch(...){}}

int scale(int value){return MulDiv(value,g_dpi,96);}
int hairline(){return std::max(1,scale(1));}
const Palette& palette(){return g_dark?kDarkPalette:kLightPalette;}
bool systemDarkMode(){DWORD value=1,size=static_cast<DWORD>(sizeof(value));if(RegGetValueW(HKEY_CURRENT_USER,L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",L"AppsUseLightTheme",RRF_RT_REG_DWORD,nullptr,&value,&size)!=ERROR_SUCCESS)return false;return value==0;}
void applyTitleBarTheme(HWND window){const BOOL enabled=g_dark?TRUE:FALSE;DwmSetWindowAttribute(window,kImmersiveDarkMode,&enabled,sizeof(enabled));}
HFONT makeFont(int points,int weight){return CreateFontW(-MulDiv(points,g_dpi,72),0,0,0,weight,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH|FF_DONTCARE,L"Segoe UI");}
void releaseFonts(){for(HFONT* font:{&g_titleFont,&g_bodyFont,&g_captionFont,&g_badgeFont})if(*font){DeleteObject(*font);*font=nullptr;}}
void createFonts(){
  releaseFonts();g_titleFont=makeFont(19,FW_SEMIBOLD);g_bodyFont=makeFont(10,FW_NORMAL);g_captionFont=makeFont(9,FW_NORMAL);g_badgeFont=makeFont(13,FW_BOLD);
  for(const auto control:{g_title,g_status,g_path,g_installButton,g_cancelButton,g_languageButton,g_browseButton})if(control)SendMessageW(control,WM_SETFONT,reinterpret_cast<WPARAM>(control==g_title?g_titleFont:(control==g_path?g_captionFont:g_bodyFont)),TRUE);
}
void createBrushes(){if(g_surfaceBrush)DeleteObject(g_surfaceBrush);if(g_bandBrush)DeleteObject(g_bandBrush);g_surfaceBrush=CreateSolidBrush(palette().surface);g_bandBrush=CreateSolidBrush(palette().band);}
struct Metrics{int width,height,pad,headerHeight,footerHeight,buttonWidth,buttonHeight,gap,badge;};
Metrics metrics(HWND window){RECT client{};GetClientRect(window,&client);Metrics value{};value.width=client.right;value.height=client.bottom;value.pad=scale(28);value.headerHeight=scale(104);value.footerHeight=scale(86);value.buttonWidth=scale(148);value.buttonHeight=scale(38);value.gap=scale(10);value.badge=scale(44);return value;}
void layout(HWND window){
  const auto value=metrics(window);if(value.width<=0||value.height<=0)return;const int content=value.width-value.pad*2,languageWidth=scale(124),languageHeight=scale(30),browseWidth=scale(96);
  MoveWindow(g_languageButton,value.width-value.pad-languageWidth,value.pad+scale(7),languageWidth,languageHeight,TRUE);
  MoveWindow(g_title,value.pad+value.badge+scale(16),value.pad+scale(4),content-value.badge-scale(16)-languageWidth-value.gap,scale(36),TRUE);
  MoveWindow(g_status,value.pad,value.headerHeight+scale(22),content,scale(86),TRUE);
  MoveWindow(g_path,value.pad,value.headerHeight+scale(112),directStartMode()?content:content-browseWidth-value.gap,scale(directStartMode()?52:38),TRUE);
  MoveWindow(g_browseButton,value.width-value.pad-browseWidth,value.headerHeight+scale(108),browseWidth,scale(34),TRUE);
  MoveWindow(g_progress,value.pad,value.height-value.footerHeight-scale(24),content,scale(6),TRUE);
  const int buttonTop=value.height-value.footerHeight+(value.footerHeight-value.buttonHeight)/2;
  MoveWindow(g_cancelButton,value.width-value.pad-value.buttonWidth,buttonTop,value.buttonWidth,value.buttonHeight,TRUE);
  MoveWindow(g_installButton,value.width-value.pad-value.buttonWidth*2-value.gap,buttonTop,value.buttonWidth,value.buttonHeight,TRUE);
  InvalidateRect(window,nullptr,TRUE);
}
void paintBackground(HDC dc,HWND window){
  const auto value=metrics(window);const auto& colors=palette();const int bandTop=value.height-value.footerHeight;
  RECT surface{0,0,value.width,bandTop};FillRect(dc,&surface,g_surfaceBrush);RECT band{0,bandTop,value.width,value.height};FillRect(dc,&band,g_bandBrush);
  HBRUSH border=CreateSolidBrush(colors.border);RECT bandLine{0,bandTop,value.width,bandTop+hairline()};FillRect(dc,&bandLine,border);
  RECT headerLine{value.pad,value.headerHeight,value.width-value.pad,value.headerHeight+hairline()};FillRect(dc,&headerLine,border);DeleteObject(border);
  HBRUSH accent=CreateSolidBrush(colors.accent);HPEN pen=CreatePen(PS_SOLID,hairline(),colors.accent);HGDIOBJ oldBrush=SelectObject(dc,accent),oldPen=SelectObject(dc,pen);
  const int radius=scale(12);RoundRect(dc,value.pad,value.pad,value.pad+value.badge,value.pad+value.badge,radius,radius);
  SelectObject(dc,oldPen);SelectObject(dc,oldBrush);DeleteObject(pen);DeleteObject(accent);
  RECT badge{value.pad,value.pad,value.pad+value.badge,value.pad+value.badge};HGDIOBJ oldFont=SelectObject(dc,g_badgeFont);
  SetBkMode(dc,TRANSPARENT);SetTextColor(dc,colors.accentText);DrawTextW(dc,L"CW",-1,&badge,DT_CENTER|DT_VCENTER|DT_SINGLELINE|DT_NOPREFIX);SelectObject(dc,oldFont);
}
enum class ButtonStyle{Primary,Secondary,Quiet};
void drawButton(const DRAWITEMSTRUCT* item,ButtonStyle style){
  const auto& colors=palette();const bool disabled=(item->itemState&ODS_DISABLED)!=0,pressed=(item->itemState&ODS_SELECTED)!=0,focused=(item->itemState&ODS_FOCUS)!=0;
  const COLORREF backdropColor=style==ButtonStyle::Quiet?colors.surface:colors.band;
  COLORREF fill=colors.quietFill,border=colors.border,foreground=disabled?colors.disabledText:colors.body;
  if(style==ButtonStyle::Primary){fill=disabled?colors.disabledFill:(pressed?colors.accentPressed:colors.accent);border=fill;foreground=disabled?colors.disabledText:colors.accentText;}
  else if(style==ButtonStyle::Quiet){fill=pressed?colors.quietPressed:backdropColor;border=pressed?colors.border:backdropColor;}
  else fill=pressed?colors.quietPressed:colors.quietFill;
  HDC dc=item->hDC;RECT rect=item->rcItem;const int radius=scale(8);
  HBRUSH backdrop=CreateSolidBrush(backdropColor);FillRect(dc,&rect,backdrop);DeleteObject(backdrop);
  HBRUSH brush=CreateSolidBrush(fill);HPEN pen=CreatePen(PS_SOLID,hairline(),border);HGDIOBJ oldBrush=SelectObject(dc,brush),oldPen=SelectObject(dc,pen);
  RoundRect(dc,rect.left,rect.top,rect.right,rect.bottom,radius,radius);SelectObject(dc,oldPen);SelectObject(dc,oldBrush);DeleteObject(pen);DeleteObject(brush);
  if(focused&&!disabled){HPEN focusPen=CreatePen(PS_SOLID,std::max(1,scale(2)),style==ButtonStyle::Primary?colors.accentPressed:colors.accent);HGDIOBJ hollow=SelectObject(dc,GetStockObject(NULL_BRUSH)),previous=SelectObject(dc,focusPen);const int inset=scale(3);
    RoundRect(dc,rect.left+inset,rect.top+inset,rect.right-inset,rect.bottom-inset,radius,radius);SelectObject(dc,previous);SelectObject(dc,hollow);DeleteObject(focusPen);}
  wchar_t caption[160]={};GetWindowTextW(item->hwndItem,caption,160);
  SetBkMode(dc,TRANSPARENT);SetTextColor(dc,foreground);HGDIOBJ oldFont=SelectObject(dc,g_bodyFont);
  DrawTextW(dc,caption,-1,&rect,DT_CENTER|DT_VCENTER|DT_SINGLELINE|DT_NOPREFIX|DT_END_ELLIPSIS);SelectObject(dc,oldFont);
}
void applyStatus(const std::wstring& value){if(g_status)SetWindowTextW(g_status,value.c_str());}
std::wstring installLocationText(){try{return text(Text::InstallLocation)+(g_requestedInstallRoot.empty()?defaultInstallRoot():g_requestedInstallRoot).wstring();}catch(...){return text(Text::InstallLocationUnknown);}}
std::wstring connectionText(){return text(Text::ThisComputer)+g_origin+L"\n"+text(Text::OtherDevices)+(g_external.empty()?text(Text::OtherDevicesHint):g_external);}
void renderState();
int CALLBACK browseCallback(HWND dialog,UINT message,LPARAM,LPARAM data){if(message==BFFM_INITIALIZED&&data)SendMessageW(dialog,BFFM_SETSELECTIONW,TRUE,data);return 0;}
void browseInstallRoot(HWND owner){
  const HRESULT initialized=CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED);auto initial=(g_requestedInstallRoot.empty()?defaultInstallRoot():g_requestedInstallRoot).wstring();BROWSEINFOW info{};info.hwndOwner=owner;info.lpszTitle=text(Text::BrowseTitle);info.ulFlags=BIF_RETURNONLYFSDIRS|BIF_NEWDIALOGSTYLE|BIF_EDITBOX;info.lpfn=browseCallback;info.lParam=reinterpret_cast<LPARAM>(initial.c_str());
  PIDLIST_ABSOLUTE selected=SHBrowseForFolderW(&info);if(selected){wchar_t path[MAX_PATH]={};if(SHGetPathFromIDListW(selected,path)){std::filesystem::path candidate(path);if(comparablePath(candidate)!=comparablePath(initial)&&_wcsicmp(candidate.filename().c_str(),L"Claudex Workhouse"))candidate/=L"Claudex Workhouse";if(validInstallRoot(candidate)){g_requestedInstallRoot=std::filesystem::absolute(candidate).lexically_normal();persistInstallRoot(g_requestedInstallRoot);renderState();}}CoTaskMemFree(selected);}if(SUCCEEDED(initialized))CoUninitialize();
}
void renderState(){
  if(!g_window)return;
  SetWindowTextW(g_window,text(directStartMode()?Text::StatusWindowTitle:Text::WindowTitle));setButton(g_languageButton,kLocaleNames[static_cast<size_t>(g_locale)],true);
  switch(g_wizardState){
    case WizardState::Welcome:
      SetWindowTextW(g_title,text(Text::WelcomeTitle));applyStatus(text(Text::WelcomeBody));SetWindowTextW(g_path,installLocationText().c_str());
      setProgress(false);showControl(g_browseButton,true);setButton(g_browseButton,text(Text::ButtonBrowse),true);setButton(g_installButton,text(Text::ButtonInstall),true);setButton(g_cancelButton,text(Text::ButtonCancel),true);break;
    case WizardState::Installing:
      SetWindowTextW(g_title,text(Text::InstallingTitle));applyStatus(text(Text::InstallingBody));SetWindowTextW(g_path,installLocationText().c_str());
      setProgress(true);showControl(g_browseButton,false);setButton(g_installButton,text(Text::ButtonInstalling),false);setButton(g_cancelButton,text(Text::ButtonCancel),false);break;
    case WizardState::Starting:
      SetWindowTextW(g_title,text(g_installedStatusMode?Text::StatusStartingTitle:Text::StartingTitle));applyStatus(text(g_statusKey==Text::None?(g_portableMode?Text::PortableStartingBody:(g_installedStatusMode?Text::StatusStartingBody:Text::StartingBody)):g_statusKey));SetWindowTextW(g_path,(directStartMode()?connectionText():text(Text::StartingPath)).c_str());
      setProgress(true);showControl(g_browseButton,false);setButton(g_installButton,text(directStartMode()?Text::ButtonStarting:Text::ButtonInstalling),false);setButton(g_cancelButton,text(Text::ButtonCancel),true);break;
    case WizardState::Ready:
      SetWindowTextW(g_title,text(directStartMode()?Text::StatusReadyTitle:Text::ReadyTitle));applyStatus(text(g_statusKey==Text::None?(directStartMode()?Text::StatusReadyBody:Text::ReadyBody):g_statusKey));SetWindowTextW(g_path,(directStartMode()?connectionText():installLocationText()).c_str());
      setProgress(false);showControl(g_browseButton,false);setButton(g_installButton,text(Text::ButtonOpen),true);setButton(g_cancelButton,text(directStartMode()?Text::ButtonClose:Text::ButtonFinish),true);break;
    case WizardState::Failed:{
      SetWindowTextW(g_title,text(directStartMode()?Text::StatusFailedTitle:Text::FailedTitle));std::wstring body=text(g_portableMode?Text::PortableFailedBody:(g_installedStatusMode?Text::StatusFailedBody:Text::FailedBody));
      try{if(!g_startError.empty())body+=L"\n"+std::wstring(text(Text::FailedCause))+utf8(g_startError);if(!g_launcherDiagnosis.empty())body+=L"\n"+utf8(g_launcherDiagnosis.substr(0,g_launcherDiagnosis.find(' ')));}catch(...){}
      applyStatus(body);setProgress(false);showControl(g_browseButton,false);setButton(g_installButton,text(Text::ButtonRetry),true);setButton(g_cancelButton,text(Text::ButtonClose),true);
      try{SetWindowTextW(g_path,(text(Text::ErrorLog)+(std::filesystem::path(localDataRoot())/L"logs"/L"windows-launcher-error.log").wstring()).c_str());}catch(...){SetWindowTextW(g_path,L"");}break;
    }
  }
  InvalidateRect(g_window,nullptr,FALSE);
}
void showWelcome(){g_wizardState=WizardState::Welcome;g_statusKey=Text::None;renderState();}
DWORD WINAPI installWorker(LPVOID parameter){const bool success=startServer();PostMessageW(static_cast<HWND>(parameter),kInstallFinished,success?1:0,0);return 0;}
void beginOperation(HWND window){
  if(g_wizardState==WizardState::Installing||g_wizardState==WizardState::Starting)return;
  g_wizardState=directStartMode()?WizardState::Starting:WizardState::Installing;g_statusKey=Text::None;g_startError.clear();renderState();
  g_installThread=CreateThread(nullptr,0,installWorker,window,0,nullptr);if(!g_installThread){g_startError="installer thread";PostMessageW(window,kInstallFinished,0,0);}
}
// Both the log file and the failure screen have to say which launcher form ran
// and what it found beside itself, so a portable start that fails is never
// mistaken for a product decision to install.
void writeLauncherError(){
  try{atomicBytes(std::filesystem::path(localDataRoot())/L"logs"/L"windows-launcher-error.log",g_startError+"\n"+g_launcherDiagnosis+"\n");}catch(...){}
}
void showFailure(){g_wizardState=WizardState::Failed;g_statusKey=Text::None;renderState();}
void showReady(){g_wizardState=WizardState::Ready;g_statusKey=Text::None;renderState();}
std::wstring browserUrl(const std::wstring& query=L""){std::wstring value=g_origin+L"/"+query;if(!g_entryConsumed&&!g_entryToken.empty())value+=L"#entry="+g_entryToken;return value;}
void openUrl(const std::wstring& value){ShellExecuteW(nullptr,L"open",value.c_str(),nullptr,nullptr,SW_SHOWNORMAL);}
HMENU menuId(int value){return reinterpret_cast<HMENU>(static_cast<INT_PTR>(value));}
bool workhouseServer(const std::string& body){return jsonString(body,"product")=="claudex-workhouse"&&jsonUnsignedEquals(body,"schemaVersion",1);}
void releaseOwnedServer(bool keepRunning){
  if(!g_ownsServer){if(g_serverLog){CloseHandle(g_serverLog);g_serverLog=nullptr;}return;}
  if(g_job){if(keepRunning){JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};SetInformationJobObject(g_job,JobObjectExtendedLimitInformation,&limits,sizeof(limits));}CloseHandle(g_job);g_job=nullptr;}
  if(g_serverLog){CloseHandle(g_serverLog);g_serverLog=nullptr;}
  if(g_server.hThread){CloseHandle(g_server.hThread);g_server.hThread=nullptr;}if(g_server.hProcess){CloseHandle(g_server.hProcess);g_server.hProcess=nullptr;}g_ownsServer=false;
}
std::string serverLogTail(){
  if(!g_serverLog)return{};FlushFileBuffers(g_serverLog);LARGE_INTEGER size{};if(!GetFileSizeEx(g_serverLog,&size)||size.QuadPart<=0)return{};constexpr LONGLONG limit=16*1024;LARGE_INTEGER position{};position.QuadPart=std::max<LONGLONG>(0,size.QuadPart-limit);if(!SetFilePointerEx(g_serverLog,position,nullptr,FILE_BEGIN))return{};std::vector<char> buffer(static_cast<size_t>(size.QuadPart-position.QuadPart));DWORD count=0;if(buffer.empty()||!ReadFile(g_serverLog,buffer.data(),static_cast<DWORD>(buffer.size()),&count,nullptr))return{};return std::string(buffer.data(),count);
}
bool startServer(){
  try{
    if(g_ownsServer){if(g_server.hProcess&&WaitForSingleObject(g_server.hProcess,0)==WAIT_TIMEOUT)return true;releaseOwnedServer(false);}
    const auto existing=httpGet(L"/api/bootstrap/status");if(!existing.empty())return workhouseServer(existing);
    std::string embeddedManifest;std::filesystem::path embeddedTarget;
    // Portable mode never touches the installer path: no extraction into the
    // install root, no InstallRoot registry value, no shortcuts and no
    // Installed apps registration. Only the user data root is written.
    const auto base=g_portableMode?executablePath().parent_path():prepareEmbeddedPayload(embeddedManifest,embeddedTarget);std::string version;std::filesystem::path payload;if(embeddedTarget.empty()){const auto current=readBytes(base/L"current.json");const auto relative=utf8(jsonString(current,"payloadDirectory"));version=jsonString(current,"version");if(!safeRelative(relative)||version.empty())throw std::runtime_error("unsafe payload path");payload=std::filesystem::absolute(base/std::filesystem::path(relative).make_preferred()).lexically_normal();}else{version=jsonString(embeddedManifest,"version");payload=embeddedTarget;}
    // Containment and existence are decided on normalised, extended-length
    // paths. Canonicalisation differs between toolchains, and a relative
    // component out of current.json arrives with forward slashes.
    const auto canonicalBase=std::filesystem::absolute(base).lexically_normal();payload=std::filesystem::absolute(payload).lexically_normal();
    if(!pathContains(canonicalBase,payload)||comparablePath(canonicalBase)==comparablePath(payload))throw std::runtime_error("payload escape");
    if(!win32Directory(extendedPath(payload).wstring()))throw std::runtime_error("payload root");if(!g_portableMode&&embeddedTarget.empty()&&registeredInstallRoot(base)&&!_wcsicmp(std::filesystem::absolute(executablePath()).c_str(),std::filesystem::absolute(installedLauncher(base)).c_str()))registerInstalledApplication(base,version);
    const auto node=payload/L"node.exe",app=payload/L"app",script=app/L"start.mjs";if(embeddedManifest.empty())verifyPayload(base,payload,version);if(!win32RegularFile(extendedPath(node).wstring())||!win32RegularFile(extendedPath(script).wstring()))throw std::runtime_error("payload incomplete");
    g_installRoot=base;g_payloadRoot=payload;g_entryToken=randomToken();g_entryConsumed=false;SetEnvironmentVariableW(L"CLAUDEX_WORKHOUSE_ENTRY_TOKEN",g_entryToken.c_str());SetEnvironmentVariableW(L"CLAUDEX_WORKHOUSE_APP_ROOT",app.c_str());SetEnvironmentVariableW(L"CLAUDEX_WORKHOUSE_INSTALL_METHOD",L"windows-portable");SetEnvironmentVariableW(L"CLAUDEX_WORKHOUSE_UPDATER_PROTOCOL_VERSION",L"1");const auto data=localDataRoot();SetEnvironmentVariableW(L"CLAUDEX_WORKHOUSE_DATA_ROOT",data.c_str());
    try{auto packageSha=readBytes(base/L".claudex-package-sha256");packageSha.erase(std::remove_if(packageSha.begin(),packageSha.end(),[](char value){return value=='\r'||value=='\n'||value==' ';}),packageSha.end());if(std::regex_match(packageSha,std::regex(R"(^[a-f0-9]{64}$)")))SetEnvironmentVariableW(L"CLAUDEX_WORKHOUSE_PACKAGE_SHA256",utf8(packageSha).c_str());else SetEnvironmentVariableW(L"CLAUDEX_WORKHOUSE_PACKAGE_SHA256",nullptr);}catch(...){SetEnvironmentVariableW(L"CLAUDEX_WORKHOUSE_PACKAGE_SHA256",nullptr);}
    const auto logDirectory=std::filesystem::path(data)/L"logs",startupLog=logDirectory/L"windows-server-startup.log";std::filesystem::create_directories(extendedPath(logDirectory));SECURITY_ATTRIBUTES logSecurity{sizeof(logSecurity),nullptr,TRUE};g_serverLog=CreateFileW(extendedPath(startupLog).c_str(),GENERIC_READ|FILE_APPEND_DATA,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,&logSecurity,OPEN_ALWAYS,FILE_ATTRIBUTE_NORMAL,nullptr);if(g_serverLog==INVALID_HANDLE_VALUE){const auto fallback=logDirectory/(L"windows-server-startup."+std::to_wstring(GetCurrentProcessId())+L".log");g_serverLog=CreateFileW(extendedPath(fallback).c_str(),GENERIC_READ|FILE_APPEND_DATA,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,&logSecurity,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr);}if(g_serverLog==INVALID_HANDLE_VALUE){g_serverLog=nullptr;throw std::runtime_error("server log");}
    std::wstring command=quote(node.wstring())+L" "+quote(script.wstring());STARTUPINFOW startup{};startup.cb=sizeof(startup);startup.dwFlags=STARTF_USESHOWWINDOW|STARTF_USESTDHANDLES;startup.wShowWindow=SW_HIDE;startup.hStdOutput=g_serverLog;startup.hStdError=g_serverLog;startup.hStdInput=nullptr;std::vector<wchar_t> mutableCommand(command.begin(),command.end());mutableCommand.push_back(L'\0');
    const BOOL created=CreateProcessW(node.c_str(),mutableCommand.data(),nullptr,nullptr,TRUE,CREATE_NO_WINDOW|CREATE_UNICODE_ENVIRONMENT|CREATE_SUSPENDED,nullptr,app.c_str(),&startup,&g_server);if(!created){CloseHandle(g_serverLog);g_serverLog=nullptr;throw std::runtime_error("server start");}
    g_job=CreateJobObjectW(nullptr,nullptr);JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;if(!g_job||!SetInformationJobObject(g_job,JobObjectExtendedLimitInformation,&limits,sizeof(limits))||!AssignProcessToJobObject(g_job,g_server.hProcess)||ResumeThread(g_server.hThread)==static_cast<DWORD>(-1)){if(g_job){CloseHandle(g_job);g_job=nullptr;}TerminateProcess(g_server.hProcess,1);CloseHandle(g_server.hThread);CloseHandle(g_server.hProcess);g_server={};throw std::runtime_error("server job");}
    g_ownsServer=true;if(!g_portableMode&&registeredInstallRoot(base))storeServerPid(g_server.dwProcessId);SetEnvironmentVariableW(L"CLAUDEX_WORKHOUSE_ENTRY_TOKEN",nullptr);return true;
  }catch(const std::exception& error){g_startError=error.what();releaseOwnedServer(false);SetEnvironmentVariableW(L"CLAUDEX_WORKHOUSE_ENTRY_TOKEN",nullptr);return false;}
  catch(...){g_startError="unknown launcher error";releaseOwnedServer(false);SetEnvironmentVariableW(L"CLAUDEX_WORKHOUSE_ENTRY_TOKEN",nullptr);return false;}
}
bool beginPendingUpdate(HWND window){
  if(g_updateStarted||g_installRoot.empty()||g_payloadRoot.empty())return false;const auto requests=std::filesystem::path(localDataRoot())/L"runtime"/L"application-updates"/L"requests";if(!std::filesystem::exists(requests))return false;
  for(const auto& item:std::filesystem::directory_iterator(requests)){const DWORD attributes=GetFileAttributesW(item.path().c_str());if(attributes==INVALID_FILE_ATTRIBUTES||(attributes&FILE_ATTRIBUTE_REPARSE_POINT)||!item.is_regular_file()||item.path().extension()!=L".json")continue;std::string body;try{body=readBytes(item.path());}catch(...){continue;}if(jsonString(body,"installMethod")!="windows-portable")continue;const auto attempt=jsonString(body,"attemptId");if(!std::regex_match(attempt,std::regex(R"(^[0-9a-fA-F-]{36}$)"))||item.path().stem()!=utf8(attempt))continue;
    const auto node=g_payloadRoot/L"node.exe",updater=g_payloadRoot/L"app"/L"dist-server"/L"windows"/L"portable-updater.js";if(!std::filesystem::is_regular_file(node)||!std::filesystem::is_regular_file(updater))continue;std::wstring command=quote(node.wstring())+L" "+quote(updater.wstring())+L" "+quote(item.path().wstring())+L" "+quote(g_installRoot.wstring());STARTUPINFOW startup{};startup.cb=sizeof(startup);PROCESS_INFORMATION process{};std::vector<wchar_t> mutableCommand(command.begin(),command.end());mutableCommand.push_back(L'\0');if(!CreateProcessW(node.c_str(),mutableCommand.data(),nullptr,nullptr,FALSE,CREATE_NO_WINDOW|CREATE_NEW_PROCESS_GROUP|CREATE_UNICODE_ENVIRONMENT,nullptr,g_payloadRoot.c_str(),&startup,&process))continue;CloseHandle(process.hThread);CloseHandle(process.hProcess);g_updateStarted=true;g_statusKey=Text::UpdateStopping;renderState();releaseOwnedServer(false);DestroyWindow(window);return true;
  }return false;
}
void setStatusKey(Text key){if(g_statusKey==key)return;g_statusKey=key;renderState();}
void poll(){
  if(g_ownsServer&&g_server.hProcess&&WaitForSingleObject(g_server.hProcess,0)==WAIT_OBJECT_0){DWORD exitCode=1;GetExitCodeProcess(g_server.hProcess,&exitCode);g_startError="server exited with code "+std::to_string(exitCode);const auto detail=serverLogTail();if(!detail.empty())g_startError+="\n"+detail;writeLauncherError();releaseOwnedServer(false);showFailure();return;}
  const auto body=httpGet(L"/api/bootstrap/status");if(body.empty()){setStatusKey(Text::None);return;}
  std::string overall;try{if(!workhouseServer(body)){g_external.clear();setStatusKey(Text::PortBusy);return;}if(jsonBoolean(body,"consumed"))g_entryConsumed=true;g_external=utf8(jsonOptionalString(body,"external"));overall=jsonString(body,"overall");}catch(...){g_external.clear();setStatusKey(Text::ProbeWait);return;}
  if(g_wizardState==WizardState::Starting)showReady();
  setStatusKey(overall=="attention"?Text::ReadyAttention:(overall=="failed"?Text::ReadyConfigFailed:Text::None));
}
LRESULT CALLBACK windowProc(HWND window,UINT message,WPARAM wParam,LPARAM lParam){
  switch(message){
    case WM_CREATE:{
      g_window=window;const UINT dpi=GetDpiForWindow(window);g_dpi=dpi>0?static_cast<int>(dpi):96;g_dark=systemDarkMode();createBrushes();applyTitleBarTheme(window);
      g_title=CreateWindowW(L"STATIC",L"",WS_CHILD|WS_VISIBLE|SS_NOPREFIX,0,0,0,0,window,nullptr,nullptr,nullptr);
      g_status=CreateWindowW(L"STATIC",L"",WS_CHILD|WS_VISIBLE|SS_NOPREFIX,0,0,0,0,window,nullptr,nullptr,nullptr);
      g_path=CreateWindowW(L"STATIC",L"",WS_CHILD|WS_VISIBLE|SS_NOPREFIX,0,0,0,0,window,nullptr,nullptr,nullptr);
      g_progress=CreateWindowExW(0,PROGRESS_CLASSW,L"",WS_CHILD|PBS_MARQUEE|PBS_SMOOTH,0,0,0,0,window,nullptr,nullptr,nullptr);
      g_installButton=CreateWindowW(L"BUTTON",L"",WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW,0,0,0,0,window,menuId(kInstall),nullptr,nullptr);
      g_cancelButton=CreateWindowW(L"BUTTON",L"",WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW,0,0,0,0,window,menuId(kCancel),nullptr,nullptr);
      g_languageButton=CreateWindowW(L"BUTTON",L"",WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW,0,0,0,0,window,menuId(kLanguage),nullptr,nullptr);
      g_browseButton=CreateWindowW(L"BUTTON",L"",WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW,0,0,0,0,window,menuId(kBrowse),nullptr,nullptr);
      createFonts();layout(window);SetTimer(window,kPollTimer,1000,nullptr);if(directStartMode())beginOperation(window);else{showWelcome();if(g_autoInstall)PostMessageW(window,WM_COMMAND,kInstall,0);}return 0;
    }
    case WM_ERASEBKGND:paintBackground(reinterpret_cast<HDC>(wParam),window);return 1;
    case WM_CTLCOLORSTATIC:{
      const HDC dc=reinterpret_cast<HDC>(wParam);const HWND control=reinterpret_cast<HWND>(lParam);SetBkMode(dc,TRANSPARENT);
      SetTextColor(dc,control==g_title?palette().title:(control==g_path?palette().muted:palette().body));return reinterpret_cast<LRESULT>(g_surfaceBrush);
    }
    case WM_DRAWITEM:{
      const auto* item=reinterpret_cast<const DRAWITEMSTRUCT*>(lParam);if(item->CtlType!=ODT_BUTTON)break;
      drawButton(item,item->hwndItem==g_installButton?ButtonStyle::Primary:(item->hwndItem==g_languageButton?ButtonStyle::Quiet:ButtonStyle::Secondary));return TRUE;
    }
    case WM_SIZE:layout(window);return 0;
    case WM_DPICHANGED:{
      g_dpi=static_cast<int>(HIWORD(wParam));createFonts();const RECT* suggested=reinterpret_cast<const RECT*>(lParam);
      SetWindowPos(window,nullptr,suggested->left,suggested->top,suggested->right-suggested->left,suggested->bottom-suggested->top,SWP_NOZORDER|SWP_NOACTIVATE);layout(window);return 0;
    }
    case WM_SETTINGCHANGE:
      if(lParam!=0&&!lstrcmpiW(reinterpret_cast<const wchar_t*>(lParam),L"ImmersiveColorSet")){g_dark=systemDarkMode();createBrushes();applyTitleBarTheme(window);InvalidateRect(window,nullptr,TRUE);}
      return 0;
    case WM_TIMER:if(wParam==kPollTimer&&(g_wizardState==WizardState::Starting||g_wizardState==WizardState::Ready)){if(!beginPendingUpdate(window))poll();}return 0;
    case kInstallFinished:
      if(g_installThread){CloseHandle(g_installThread);g_installThread=nullptr;}
      if(wParam){g_wizardState=WizardState::Starting;g_statusKey=Text::None;renderState();poll();}
      else{writeLauncherError();showFailure();}
      return 0;
    case WM_COMMAND:{
      const int command=LOWORD(wParam);
      if(command==kLanguage){
        HMENU menu=CreatePopupMenu();if(!menu)return 0;
        for(size_t index=0;index<kLocaleCount;++index)AppendMenuW(menu,MF_STRING|(index==static_cast<size_t>(g_locale)?MF_CHECKED:MF_UNCHECKED),static_cast<UINT_PTR>(kLanguageFirst+static_cast<int>(index)),kLocaleNames[index]);
        RECT rect{};GetWindowRect(g_languageButton,&rect);
        const int choice=TrackPopupMenu(menu,TPM_RIGHTALIGN|TPM_TOPALIGN|TPM_RETURNCMD|TPM_NONOTIFY,rect.right,rect.bottom,0,window,nullptr);DestroyMenu(menu);
        if(choice>=kLanguageFirst&&choice<kLanguageFirst+static_cast<int>(kLocaleCount)){g_locale=static_cast<Locale>(choice-kLanguageFirst);persistLocale();renderState();InvalidateRect(window,nullptr,TRUE);}
        return 0;
      }
      if(command==kBrowse&&g_wizardState==WizardState::Welcome){browseInstallRoot(window);return 0;}
      if(command==kInstall||command==IDOK){if(g_wizardState==WizardState::Ready)openUrl(browserUrl());else if(g_wizardState!=WizardState::Installing&&g_wizardState!=WizardState::Starting)beginOperation(window);}
      else if((command==kCancel||command==IDCANCEL)&&g_wizardState!=WizardState::Installing){if(g_wizardState==WizardState::Ready)releaseOwnedServer(true);else if(g_wizardState==WizardState::Starting)releaseOwnedServer(false);DestroyWindow(window);}
      return 0;
    }
    case WM_CLOSE:
      if(g_wizardState==WizardState::Installing){MessageBoxW(window,text(Text::BusyClose),text(Text::WindowTitle),MB_OK|MB_ICONINFORMATION);return 0;}
      if(g_wizardState==WizardState::Starting)releaseOwnedServer(false);
      if(g_wizardState==WizardState::Ready)releaseOwnedServer(true);DestroyWindow(window);return 0;
    case WM_DESTROY:
      KillTimer(window,kPollTimer);releaseFonts();
      if(g_surfaceBrush){DeleteObject(g_surfaceBrush);g_surfaceBrush=nullptr;}if(g_bandBrush){DeleteObject(g_bandBrush);g_bandBrush=nullptr;}
      g_window=nullptr;releaseOwnedServer(false);PostQuitMessage(0);return 0;
  }
  return DefWindowProcW(window,message,wParam,lParam);
}
}

int WINAPI wWinMain(HINSTANCE instance,HINSTANCE,LPWSTR commandLine,int){
  const std::wstring arguments=commandLine?commandLine:L"";g_requestedInstallRoot=loadInstallRoot();int argumentCount=0;LPWSTR* argumentValues=CommandLineToArgvW(GetCommandLineW(),&argumentCount);
  if(argumentValues){for(int index=1;index<argumentCount;++index){const std::wstring argument=argumentValues[index];if(argument==L"--install")g_autoInstall=true;else if(argument==L"--diagnose")g_diagnose=true;else if(argument==L"--uninstall")g_uninstall=true;else if(argument==L"--quiet")g_quietUninstall=true;else if(argument.rfind(L"--install-root=",0)==0){const std::filesystem::path candidate=argument.substr(15);if(validInstallRoot(candidate))g_requestedInstallRoot=std::filesystem::absolute(candidate).lexically_normal();}else if(argument==L"--install-root"&&index+1<argumentCount){const std::filesystem::path candidate=argumentValues[++index];if(validInstallRoot(candidate))g_requestedInstallRoot=std::filesystem::absolute(candidate).lexically_normal();}}LocalFree(argumentValues);}
  g_locale=detectLocale(arguments);if(g_uninstall)return uninstallApplication();
  // Only a launcher that actually carries an embedded payload has anything to
  // install, so only that one may open the installation wizard. Every other
  // launcher starts what is already on disk: the registered installation, or
  // the folder this EXE was extracted into. A portable folder whose payload is
  // incomplete fails as a portable start, with a cause and a log — it is never
  // answered with an install prompt, because that hides the real fault.
  const bool embedded=embeddedPayloadPresent();
  g_installedStatusMode=!g_autoInstall&&installedStatusLauncher();
  g_portableMode=!g_autoInstall&&!g_installedStatusMode&&!embedded;
  g_launcherDiagnosis=std::string("mode=")+(g_installedStatusMode?"installed-status":(g_portableMode?"portable":"installer"))+" "+describeLauncherLayout(embedded);
  if(g_diagnose){try{atomicBytes(std::filesystem::path(localDataRoot())/L"logs"/L"windows-launcher-diagnostics.log",g_launcherDiagnosis+"\n");}catch(...){try{atomicBytes(executablePath().parent_path()/L"windows-launcher-diagnostics.log",g_launcherDiagnosis+"\n");}catch(...){return 1;}}return 0;}INITCOMMONCONTROLSEX controls{sizeof(controls),ICC_PROGRESS_CLASS|ICC_STANDARD_CLASSES};InitCommonControlsEx(&controls);
  HANDLE mutex=CreateMutexW(nullptr,TRUE,kMutex);if(!mutex)return 1;if(GetLastError()==ERROR_ALREADY_EXISTS){openUrl(g_origin);CloseHandle(mutex);return 0;}
  WNDCLASSW klass{};klass.lpfnWndProc=windowProc;klass.hInstance=instance;klass.lpszClassName=kWindowClass;klass.hCursor=LoadCursor(nullptr,IDC_ARROW);klass.hbrBackground=nullptr;if(!RegisterClassW(&klass)){CloseHandle(mutex);return 1;}
  constexpr DWORD style=WS_OVERLAPPED|WS_CAPTION|WS_SYSMENU|WS_MINIMIZEBOX;
  HWND window=CreateWindowW(kWindowClass,text(directStartMode()?Text::StatusWindowTitle:Text::WindowTitle),style,CW_USEDEFAULT,CW_USEDEFAULT,kBaseWidth,kBaseHeight,nullptr,nullptr,instance,nullptr);if(!window){CloseHandle(mutex);return 1;}
  RECT frame{0,0,MulDiv(kBaseWidth,g_dpi,96),MulDiv(kBaseHeight,g_dpi,96)};AdjustWindowRectExForDpi(&frame,style,FALSE,0,static_cast<UINT>(g_dpi));
  RECT work{};const int frameWidth=frame.right-frame.left,frameHeight=frame.bottom-frame.top;
  if(SystemParametersInfoW(SPI_GETWORKAREA,0,&work,0))SetWindowPos(window,nullptr,work.left+((work.right-work.left)-frameWidth)/2,work.top+((work.bottom-work.top)-frameHeight)/2,frameWidth,frameHeight,SWP_NOZORDER|SWP_NOACTIVATE);
  else SetWindowPos(window,nullptr,0,0,frameWidth,frameHeight,SWP_NOZORDER|SWP_NOMOVE|SWP_NOACTIVATE);
  ShowWindow(window,SW_SHOW);UpdateWindow(window);SetForegroundWindow(window);
  MSG message{};while(GetMessageW(&message,nullptr,0,0)>0){if(IsDialogMessageW(window,&message))continue;TranslateMessage(&message);DispatchMessageW(&message);}
  ReleaseMutex(mutex);CloseHandle(mutex);return static_cast<int>(message.wParam);
}
