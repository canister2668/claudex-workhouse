import {describe,expect,it} from "vitest";
import {conversationSessionLink,sessionMatchesConversationScope} from "../../src/web/conversation-session-scope";

describe("conversation provider session scope",()=>{
  const linked={id:"codex:turn",provider:"codex",threadId:"thread-linked",metadata:{collaborationSessionId:"conversation-1",collaborationParticipantId:"participant-1",collaborationMode:"debate"}};
  const ordinary={id:"codex:ordinary",provider:"codex",threadId:"thread-ordinary",metadata:{}};

  it("keeps conversation turns out of ordinary tabs and only in the linked-session tab",()=>{
    expect(conversationSessionLink(linked)).toEqual({collaborationSessionId:"conversation-1",participantId:"participant-1"});
    expect(sessionMatchesConversationScope(linked,"regular")).toBe(false);
    expect(sessionMatchesConversationScope(linked,"conversation-linked")).toBe(true);
    expect(sessionMatchesConversationScope(ordinary,"regular")).toBe(true);
    expect(sessionMatchesConversationScope(ordinary,"conversation-linked")).toBe(false);
  });


  it("classifies native Codex and Claude rows through their linked Claudex Workhouse task",()=>{
    const native={provider:"codex",threadId:"thread-linked",metadata:{}},linkedClaude={id:"claude:turn",provider:"claude",threadId:"claude-thread-linked",metadata:{collaborationSessionId:"conversation-1",collaborationParticipantId:"participant-2",collaborationMode:"debate"}},nativeClaude={id:"claude:native",provider:"claude",threadId:"claude-thread-linked",metadata:{}};
    expect(sessionMatchesConversationScope(native,"regular",[linked,ordinary])).toBe(false);
    expect(sessionMatchesConversationScope(native,"conversation-linked",[linked,ordinary])).toBe(true);
    expect(sessionMatchesConversationScope(nativeClaude,"regular",[linked,ordinary,linkedClaude])).toBe(false);
    expect(sessionMatchesConversationScope(nativeClaude,"conversation-linked",[linked,ordinary,linkedClaude])).toBe(true);
    expect(sessionMatchesConversationScope({threadId:"thread-ordinary"},"regular",[linked,ordinary])).toBe(true);
    expect(sessionMatchesConversationScope({...nativeClaude,provider:"codex"},"regular",[linkedClaude])).toBe(true);
  });

  it("keeps work collaboration participants out of the short linked-session tab",()=>{
    const workLinked={...linked,threadId:"thread-work",metadata:{collaborationSessionId:"review-1",collaborationParticipantId:"participant-review",collaborationMode:"review"}},native={provider:"codex",threadId:"thread-work",metadata:{}};
    const collaborations=new Map([["conversation-1",{mode:"debate"}],["review-1",{mode:"review"}]]);
    expect(sessionMatchesConversationScope(linked,"conversation-linked",[linked,workLinked],{collaborations})).toBe(true);
    expect(sessionMatchesConversationScope(workLinked,"conversation-linked",[linked,workLinked],{collaborations})).toBe(false);
    expect(sessionMatchesConversationScope(native,"conversation-linked",[workLinked],{collaborations})).toBe(false);
    expect(sessionMatchesConversationScope(workLinked,"regular",[linked,workLinked],{collaborations})).toBe(false);
  });

  it("keeps linked rows and their native thread copies off the home scope",()=>{
    const collaborations=new Map([["conversation-1",{mode:"debate"}]]);
    const conversation={provider:"ollama",threadId:"conversation-thread",metadata:{collaborationSessionId:"conversation-1",collaborationParticipantId:"participant-1"}},native={provider:"ollama",threadId:"conversation-thread",metadata:{}},claude={provider:"claude",threadId:"claude-thread",metadata:{}};
    const rows=[conversation,native,claude],homeRows=rows.filter(item=>sessionMatchesConversationScope(item,"regular",rows,{collaborations}));
    expect(homeRows).toEqual([claude]);
  });

  it("keeps managed and Assist work in the ordinary provider scope",()=>{
    const collaborations=new Map([["assist-1",{mode:"assist"}]]);
    const managed={id:"claude:managed",provider:"claude",threadId:"managed-thread",metadata:{collaborationSessionId:"assist-1",collaborationParticipantId:"participant-managed",collaborationMode:"assist",managedProviderSourceTaskId:"codex:source"}};
    const assist={id:"grok:assist",provider:"grok",threadId:"assist-thread",metadata:{collaborationSessionId:"assist-1",collaborationParticipantId:"participant-assist"}};
    for(const task of [managed,assist]){
      expect(sessionMatchesConversationScope(task,"regular",[managed,assist],{collaborations})).toBe(true);
      expect(sessionMatchesConversationScope(task,"conversation-linked",[managed,assist],{collaborations})).toBe(false);
    }
  });
});
