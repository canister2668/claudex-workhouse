export const EMOTIONS = [
  "neutral", "happy", "embarrassed", "sad", "angry", "surprised",
  "love", "smug", "confused", "crying", "excited", "proud",
  "scared", "sleepy", "thinking", "thinking_2", "thinking_3",
  "tired", "dead", "disappointed", "disgusted", "facepalm",
  "laughing", "nervous", "pout", "speechless", "wink", "chu", "gift",
  "coding", "coding_2", "coding_3", "building", "building_2",
  "building_3", "execute", "reading", "reading_2", "reading_3",
  "searching", "searching_2", "searching_3"
];

const COPY = {
  neutral: "편안하게 있을게요.", happy: "기분 좋아요!", embarrassed: "부끄럽게...",
  sad: "조금 슬퍼요...", angry: "으잉~!", surprised: "헉!", love: "꼬옥~ 💕",
  smug: "후훗, 제법이죠?", confused: "어라...?", crying: "으엉ㅠ", excited: "와아~! 🎉",
  proud: "해냈어요!", scared: "무서워요...", sleepy: "쿨쿨...", thinking: "음... 생각 중이에요.",
  thinking_2: "뭔가 떠오를 것 같은데...", thinking_3: "으음... 이건 좀 고민되네요.",
  tired: "조금 지쳤어요...", dead: "영혼이 빠져나갔어요...", disappointed: "아쉬워요...",
  disgusted: "으으... 싫어요.", facepalm: "아이고...", laughing: "푸하핫!", nervous: "두근두근...",
  pout: "흥!", speechless: "할 말을 잃었어요...", wink: "윙크~ 😉", chu: "쪼옥~ 💕", gift: "선물이에요~ 🎁",
  coding: "코드 수정 중이에요.", coding_2: "열심히 쓰는 중...!", coding_3: "수정 사항을 다시 확인 중이에요.",
  building: "명령을 실행 중이에요.", building_2: "결과를 기다리는 중...", building_3: "출력을 확인하고 있어요.",
  execute: "실행할게요!", reading: "꼼꼼히 읽는 중이에요.", reading_2: "자료를 살펴보고 있어요.",
  reading_3: "관련 내용을 확인 중이에요.", searching: "어디 있을까...?", searching_2: "관련 위치를 찾는 중이에요.",
  searching_3: "조금 더 확인해 볼게요."
};

// The UI translates `lineKey`; `line` stays for the VS Code panel and older
// clients that read the emotion state file directly.
const matched = (emotion) => ({ emotion, line: COPY[emotion] ?? "", lineKey: `avatar.match.${emotion}` });

const DIRECT = new Map(EMOTIONS.map((emotion) => [emotion.toLowerCase(), emotion]));
const RULES = [
  [/뽀뽀|키스|입맞춤|쪼+옥|츄~?|kiss|smooch/u, "chu"],
  [/^쪽(?:\s*(?:해|해\s*줘|하자)|[~!💕😘]+)?$/u, "chu"],
  [/안아\s*줘|안아줘|포옹|사랑해|좋아해|하트|love/u, "love"],
  [/선물|gift|present/u, "gift"], [/부끄|수줍|얼굴\s*빨개|embarrass|shy/u, "embarrassed"],
  [/삐졌|삐져|토라졌|토라져|pout|흥[!！]?$/u, "pout"], [/화내|화났|분노|짜증|angry|mad/u, "angry"],
  [/울어|울고|눈물|엉엉|cry(?:ing)?/u, "crying"], [/슬퍼|슬픈|우울|속상|sad/u, "sad"],
  [/웃어|웃겨|빵\s*터|폭소|ㅋㅋ|laugh/u, "laughing"], [/행복|기뻐|기쁜|활짝\s*웃|happy|joy/u, "happy"],
  [/축하|신나|흥분|기대돼|들떠|excited/u, "excited"], [/뿌듯|대견|자랑스|proud/u, "proud"],
  [/우쭐|의기양양|잘난\s*척|득의|smug/u, "smug"], [/윙크|wink/u, "wink"],
  [/놀라|깜짝|surpris/u, "surprised"], [/무서|두려|겁나|scared|afraid/u, "scared"],
  [/졸려|잠\s*와|잘\s*자|sleepy/u, "sleepy"], [/피곤|지쳤|힘들어|tired|exhausted/u, "tired"],
  [/긴장|초조|조마조마|불안|nervous|anxious/u, "nervous"], [/혼란|헷갈|이해\s*안|모르겠|confused/u, "confused"],
  [/말문\s*막|할\s*말\s*없|기가\s*막|speechless/u, "speechless"], [/한심|어이없|답답|절레|facepalm/u, "facepalm"],
  [/역겨|혐오|징그러|불쾌|disgust/u, "disgusted"], [/실망|아쉬워|disappoint/u, "disappointed"],
  [/멘붕|영혼\s*(?:나간|없)|죽은\s*표정|사망|dead/u, "dead"], [/생각|고민|think/u, "thinking"],
  [/코딩|코드\s*(?:써|수정|작성)|coding/u, "coding"], [/빌드|배포|building/u, "building"],
  [/실행\s*(?:해|해줘|할게|중)|execute/u, "execute"], [/읽어|읽는\s*표정|reading/u, "reading"],
  [/검색|찾아봐|조사|searching/u, "searching"], [/무표정|중립|기본\s*표정|평온|차분|neutral/u, "neutral"]
];

const normalize = (value) => String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");

export function matchEmotion(prompt) {
  const text = normalize(prompt);
  if (!text || text.length > 160) return null;
  const explicit = text.match(/(?:emotion|감정|표정)\s*[:=：]?\s*([a-z][a-z0-9_-]*)/u);
  if (explicit && DIRECT.has(explicit[1])) return matched(DIRECT.get(explicit[1]));
  for (const emotion of [...EMOTIONS].sort((a, b) => b.length - a.length)) {
    const token = emotion.replaceAll("_", "[ _-]");
    if (new RegExp(`(?:^|[^a-z0-9])${token}(?:$|[^a-z0-9])`, "u").test(text)) return matched(emotion);
  }
  for (const [pattern, emotion] of RULES) if (pattern.test(text)) return matched(emotion);
  return null;
}
