// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Claudex Workhouse.

// claudex-conpty-bridge: runs one program inside a Windows pseudo console and
// relays it over plain pipes.
//
//   claudex-conpty-bridge.exe --cols 100 --rows 40 [--cwd DIR] [--parent-pid PID] -- PROGRAM [ARGS...]
//
// Bytes the parent writes to this process's stdin are typed into the pseudo
// console; everything the program draws (VT sequences included) is written to
// this process's stdout. The exit code is the program's exit code, or 3 when
// the pseudo console API is unavailable and 4 when the program cannot start.
//
// Claude Code only renders its /usage screen, model picker, cloud session and
// interactive login in a terminal. Linux drives those through python3's pty
// module, which does not exist on Windows; this bridge gives the Node helpers
// the same terminal through ConPTY without shipping a native Node addon, so it
// is independent of the bundled Node ABI. The program and everything it starts
// run in a kill-on-close job: if the bridge is terminated, so is the tree.

#include <windows.h>
#include <algorithm>
#include <string>
#include <vector>

namespace {
// Declared here rather than taken from the SDK headers, which only expose
// HPCON for some NTDDI_VERSION values; the functions are resolved at run time.
using PseudoConsole=void*;
typedef HRESULT(WINAPI* CreatePseudoConsoleFn)(COORD,HANDLE,HANDLE,DWORD,PseudoConsole*);
typedef void(WINAPI* ClosePseudoConsoleFn)(PseudoConsole);
constexpr DWORD_PTR kPseudoConsoleAttribute=0x00020016; // PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE

std::wstring quoteArgument(const std::wstring& value){
  if(!value.empty()&&value.find_first_of(L" \t\n\v\"")==std::wstring::npos)return value;
  std::wstring out=L"\"";unsigned slashes=0;
  for(wchar_t ch:value){
    if(ch==L'\\'){++slashes;continue;}
    if(ch==L'"'){out.append(slashes*2+1,L'\\');out.push_back(ch);slashes=0;continue;}
    out.append(slashes,L'\\');slashes=0;out.push_back(ch);
  }
  out.append(slashes*2,L'\\');out.push_back(L'"');return out;
}

HANDLE g_job=nullptr;
struct Relay{HANDLE from;HANDLE to;};
// With --parent-pid the program tree ends when that process does, so a helper
// that is itself killed cannot leave a console program running unattended.
DWORD WINAPI watchParent(void* parameter){WaitForSingleObject(static_cast<HANDLE>(parameter),INFINITE);if(g_job)TerminateJobObject(g_job,1);return 0;}
DWORD WINAPI relay(void* parameter){
  const Relay* pipes=static_cast<Relay*>(parameter);std::vector<char> buffer(16384);
  for(;;){
    DWORD read=0;
    if(!ReadFile(pipes->from,buffer.data(),static_cast<DWORD>(buffer.size()),&read,nullptr)||!read)return 0;
    for(DWORD offset=0;offset<read;){DWORD written=0;if(!WriteFile(pipes->to,buffer.data()+offset,read-offset,&written,nullptr)||!written)return 0;offset+=written;}
  }
}
int fail(const char* message,int code){DWORD written=0;const HANDLE error=GetStdHandle(STD_ERROR_HANDLE);if(error&&error!=INVALID_HANDLE_VALUE){WriteFile(error,message,static_cast<DWORD>(lstrlenA(message)),&written,nullptr);WriteFile(error,"\n",1,&written,nullptr);}return code;}

// Second stage, running inside the pseudo console. Whether a process started
// into a pseudo console gets console std handles or silently inherits the
// parent's redirected pipes differs between Windows builds (and Wine), so this
// stage opens the console explicitly and starts the real program with those
// handles. The program then sees a terminal on every host.
int runInsideConsole(int argc,wchar_t** argv,int first){
  SECURITY_ATTRIBUTES inheritable{sizeof(inheritable),nullptr,TRUE};
  HANDLE input=CreateFileW(L"CONIN$",GENERIC_READ|GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE,&inheritable,OPEN_EXISTING,0,nullptr);
  HANDLE output=CreateFileW(L"CONOUT$",GENERIC_READ|GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE,&inheritable,OPEN_EXISTING,0,nullptr);
  if(input==INVALID_HANDLE_VALUE||output==INVALID_HANDLE_VALUE)return 3;
  SetStdHandle(STD_INPUT_HANDLE,input);SetStdHandle(STD_OUTPUT_HANDLE,output);SetStdHandle(STD_ERROR_HANDLE,output);
  std::wstring command;for(int index=first;index<argc;++index){if(!command.empty())command.push_back(L' ');command+=quoteArgument(argv[index]);}
  std::vector<wchar_t> mutableCommand(command.begin(),command.end());mutableCommand.push_back(L'\0');
  STARTUPINFOW startup{};startup.cb=sizeof(startup);startup.dwFlags=STARTF_USESTDHANDLES;startup.hStdInput=input;startup.hStdOutput=output;startup.hStdError=output;
  PROCESS_INFORMATION process{};
  if(!CreateProcessW(argv[first],mutableCommand.data(),nullptr,nullptr,TRUE,CREATE_UNICODE_ENVIRONMENT,nullptr,nullptr,&startup,&process))return 4;
  CloseHandle(process.hThread);WaitForSingleObject(process.hProcess,INFINITE);
  DWORD exitCode=1;GetExitCodeProcess(process.hProcess,&exitCode);CloseHandle(process.hProcess);return static_cast<int>(exitCode);
}
}

int wmain(int argc,wchar_t** argv){
  if(argc>=3&&std::wstring(argv[1])==L"--inside-console"&&std::wstring(argv[2])==L"--")return runInsideConsole(argc,argv,3);
  SHORT cols=120,rows=40;std::wstring cwd;int first=-1;DWORD parentPid=0;
  for(int index=1;index<argc;++index){
    const std::wstring argument=argv[index];
    if(argument==L"--"){first=index+1;break;}
    if(argument==L"--cols"&&index+1<argc)cols=static_cast<SHORT>(std::max(20,std::min(2000,_wtoi(argv[++index]))));
    else if(argument==L"--rows"&&index+1<argc)rows=static_cast<SHORT>(std::max(5,std::min(300,_wtoi(argv[++index]))));
    else if(argument==L"--cwd"&&index+1<argc)cwd=argv[++index];
    else if(argument==L"--parent-pid"&&index+1<argc)parentPid=static_cast<DWORD>(_wtoi(argv[++index]));
    else return fail("usage: claudex-conpty-bridge --cols N --rows N [--cwd DIR] [--parent-pid PID] -- PROGRAM [ARGS...]",2);
  }
  if(first<1||first>=argc)return fail("usage: claudex-conpty-bridge --cols N --rows N [--cwd DIR] [--parent-pid PID] -- PROGRAM [ARGS...]",2);

  const HMODULE kernel=GetModuleHandleW(L"kernel32.dll");
  const auto createPseudoConsole=reinterpret_cast<CreatePseudoConsoleFn>(reinterpret_cast<void*>(GetProcAddress(kernel,"CreatePseudoConsole")));
  const auto closePseudoConsole=reinterpret_cast<ClosePseudoConsoleFn>(reinterpret_cast<void*>(GetProcAddress(kernel,"ClosePseudoConsole")));
  if(!createPseudoConsole||!closePseudoConsole)return fail("conpty-unavailable",3);

  HANDLE consoleInput=nullptr,inputWriter=nullptr,outputReader=nullptr,consoleOutput=nullptr;
  if(!CreatePipe(&consoleInput,&inputWriter,nullptr,0)||!CreatePipe(&outputReader,&consoleOutput,nullptr,0))return fail("pipe",4);
  PseudoConsole console=nullptr;
  if(FAILED(createPseudoConsole(COORD{cols,rows},consoleInput,consoleOutput,0,&console)))return fail("conpty-unavailable",3);

  SIZE_T attributeSize=0;InitializeProcThreadAttributeList(nullptr,1,0,&attributeSize);
  std::vector<unsigned char> attributeStorage(attributeSize);
  STARTUPINFOEXW startup{};startup.StartupInfo.cb=sizeof(startup);
  // This bridge's own stdio are pipes. Without explicit empty std handles the
  // program would inherit those pipes instead of attaching to the pseudo
  // console, and a TUI would see "not a terminal".
  startup.StartupInfo.dwFlags=STARTF_USESTDHANDLES;
  startup.lpAttributeList=reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attributeStorage.data());
  if(!InitializeProcThreadAttributeList(startup.lpAttributeList,1,0,&attributeSize)||!UpdateProcThreadAttribute(startup.lpAttributeList,0,kPseudoConsoleAttribute,console,sizeof(console),nullptr,nullptr)){closePseudoConsole(console);return fail("attribute",4);}

  std::vector<wchar_t> self(32768);const DWORD selfLength=GetModuleFileNameW(nullptr,self.data(),static_cast<DWORD>(self.size()));
  if(!selfLength||selfLength>=self.size()){closePseudoConsole(console);return fail("self-path",4);}
  const std::wstring selfPath(self.data(),selfLength);
  std::wstring command=quoteArgument(selfPath)+L" --inside-console --";for(int index=first;index<argc;++index){command.push_back(L' ');command+=quoteArgument(argv[index]);}
  std::vector<wchar_t> mutableCommand(command.begin(),command.end());mutableCommand.push_back(L'\0');
  HANDLE job=CreateJobObjectW(nullptr,nullptr);g_job=job;JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if(job)SetInformationJobObject(job,JobObjectExtendedLimitInformation,&limits,sizeof(limits));
  PROCESS_INFORMATION process{};
  const BOOL created=CreateProcessW(selfPath.c_str(),mutableCommand.data(),nullptr,nullptr,FALSE,EXTENDED_STARTUPINFO_PRESENT|CREATE_UNICODE_ENVIRONMENT|CREATE_SUSPENDED,nullptr,cwd.empty()?nullptr:cwd.c_str(),&startup.StartupInfo,&process);
  DeleteProcThreadAttributeList(startup.lpAttributeList);
  if(!created){closePseudoConsole(console);return fail("program-start-failed",4);}
  if(job)AssignProcessToJobObject(job,process.hProcess);
  ResumeThread(process.hThread);CloseHandle(process.hThread);
  // The pseudo console owns its ends now; keeping them would stop the output
  // pipe from ever reporting end-of-file.
  CloseHandle(consoleInput);CloseHandle(consoleOutput);

  Relay output{outputReader,GetStdHandle(STD_OUTPUT_HANDLE)},input{GetStdHandle(STD_INPUT_HANDLE),inputWriter};
  // Opened while the parent is known to be alive, so a later reuse of its
  // PID cannot be mistaken for it.
  if(parentPid){HANDLE parent=OpenProcess(SYNCHRONIZE,FALSE,parentPid);if(parent){HANDLE watcher=CreateThread(nullptr,0,watchParent,parent,0,nullptr);if(watcher)CloseHandle(watcher);}}
  HANDLE outputThread=CreateThread(nullptr,0,relay,&output,0,nullptr);
  HANDLE inputThread=CreateThread(nullptr,0,relay,&input,0,nullptr);

  WaitForSingleObject(process.hProcess,INFINITE);
  DWORD exitCode=1;GetExitCodeProcess(process.hProcess,&exitCode);CloseHandle(process.hProcess);
  // Let the last frame reach the pipe, then close the console. Closing it
  // while nobody reads the output can block, so the relay keeps draining.
  Sleep(150);
  closePseudoConsole(console);
  if(outputThread){WaitForSingleObject(outputThread,2000);CloseHandle(outputThread);}
  CloseHandle(outputReader);CloseHandle(inputWriter);
  if(inputThread)CloseHandle(inputThread);
  if(job)CloseHandle(job);
  return static_cast<int>(exitCode);
}
