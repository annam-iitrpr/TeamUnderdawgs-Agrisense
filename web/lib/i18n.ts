/** Farmer facing strings in English, Hindi and Marathi.
 *
 * The agronomist dashboard is deliberately English only and says so in its footer,
 * because a half translated professional tool is worse than an untranslated one.
 */

export const LANGUAGES = [
  { code: "en", label: "English", native: "English" },
  { code: "hi", label: "Hindi", native: "हिंदी" },
  { code: "mr", label: "Marathi", native: "मराठी" },
] as const;

export type Language = (typeof LANGUAGES)[number]["code"];

const en = {
  appName: "AgriSense",
  tagline: "Know the right morning to spray",

  // Conversation
  chatGreeting: "Namaste. I can tell you the best window to apply your biostimulant.",
  chatAskCrop: "Which crop is this field?",
  chatAskLocation: "Where is the field?",
  chatAskArea: "How big is it?",
  chatAskSowing: "When did you sow?",
  chatAskProduct: "Which product do you have?",
  chatWorking: "Checking the forecast for your field",
  cropRice: "Rice",
  cropWheat: "Wheat",
  cropCotton: "Cotton",
  acres: "acres",
  weeksAgo: "weeks ago",
  monthsAgo: "months ago",
  productStressBuster: "Stress Buster",
  productYieldBooster: "Yield Booster",
  useExisting: "Use a field I already have",

  // Result
  sprayOn: "Spray on",
  timeTo: "to",
  readiness: "Readiness",
  need: "Need",
  timing: "Timing",
  conditions: "Conditions",
  valueEstimate: "Estimated value protected",
  modelEstimate: "model estimate",
  valueBasis:
    "Compares spraying in this window against spraying {days} days later, across {stress} stress days on {area} hectares.",
  setReminder: "Set a reminder",
  reminderSet: "Reminder set",
  whyThisWindow: "Why this window",
  doNotSpray: "Do not spray yet.",
  checkAgain: "Check again on",
  remindMe: "Remind me when it changes",
  openJournal: "Season journal",
  seasonHistory: "Season history",

  // Why
  whyTitle: "Why this window",
  stressForecast: "Stress over the next 14 days",
  onsetMarker: "Stress crosses the action level",
  recommendedWindow: "Recommended window",
  whatDrivesThis: "What drives this",
  notApplicable: "Not applicable for this crop",

  // Hours
  hoursTitle: "Choose your hour",
  hoursSubtitle: "Tap any hour to see why it works or why it does not",
  viable: "Good to spray",
  rejected: "Not suitable",
  deltaT: "Delta T",
  wind: "Wind",
  temperature: "Temperature",
  humidity: "Humidity",
  noHoursTitle: "No suitable hours",

  // Journal
  journalTitle: "Season journal",
  journalPrompt: "What happened on your field?",
  journalSprayed: "I sprayed",
  journalSkipped: "I could not spray",
  journalObserved: "Something I noticed",
  journalAddPhoto: "Add a photo",
  journalNote: "Add a note",
  journalVoice: "Record a voice note",
  journalSave: "Save to journal",
  journalSaved: "Saved. This is what makes next season's advice sharper for your field.",
  journalEmpty: "No entries yet. Your first note starts the record for this season.",
  historyEmpty: "Nothing recorded yet this season.",

  // Shared
  back: "Back",
  retry: "Try again",
  loading: "Loading",
  errorTitle: "Something went wrong",
  buildSprint: "Build Sprint",
  dataLive: "Live data",
  dataDemo: "Demo data",
  dataMixed: "Mixed data",
  whereDataComes: "Where this data comes from",
  language: "Language",
};

type Dict = typeof en;

const hi: Dict = {
  appName: "एग्रीसेंस",
  tagline: "छिड़काव के लिए सही सुबह जानें",

  chatGreeting: "नमस्ते। मैं आपको बायोस्टिमुलेंट छिड़कने का सबसे अच्छा समय बता सकता हूँ।",
  chatAskCrop: "इस खेत में कौन सी फसल है?",
  chatAskLocation: "खेत कहाँ है?",
  chatAskArea: "यह कितना बड़ा है?",
  chatAskSowing: "आपने बुवाई कब की थी?",
  chatAskProduct: "आपके पास कौन सा उत्पाद है?",
  chatWorking: "आपके खेत का मौसम देख रहे हैं",
  cropRice: "धान",
  cropWheat: "गेहूँ",
  cropCotton: "कपास",
  acres: "एकड़",
  weeksAgo: "सप्ताह पहले",
  monthsAgo: "महीने पहले",
  productStressBuster: "स्ट्रेस बस्टर",
  productYieldBooster: "यील्ड बूस्टर",
  useExisting: "मेरा पहले से बना खेत चुनें",

  sprayOn: "छिड़काव करें",
  timeTo: "से",
  readiness: "तैयारी",
  need: "ज़रूरत",
  timing: "समय",
  conditions: "मौसम",
  valueEstimate: "अनुमानित बचत",
  modelEstimate: "अनुमान",
  valueBasis:
    "इस समय छिड़काव करने की तुलना {days} दिन बाद छिड़काव से की गई है, {area} हेक्टेयर पर {stress} तनाव दिनों के आधार पर।",
  setReminder: "याद दिलाएँ",
  reminderSet: "याद दिलाया जाएगा",
  whyThisWindow: "यह समय क्यों",
  doNotSpray: "अभी छिड़काव न करें।",
  checkAgain: "फिर से देखें",
  remindMe: "बदलाव होने पर बताएँ",
  openJournal: "फसल डायरी",
  seasonHistory: "मौसम का ब्यौरा",

  whyTitle: "यह समय क्यों",
  stressForecast: "अगले 14 दिनों का तनाव",
  onsetMarker: "तनाव कार्रवाई स्तर पार करता है",
  recommendedWindow: "सुझाया गया समय",
  whatDrivesThis: "इसका कारण",
  notApplicable: "इस फसल के लिए लागू नहीं",

  hoursTitle: "अपना समय चुनें",
  hoursSubtitle: "कारण जानने के लिए किसी भी घंटे पर टैप करें",
  viable: "छिड़काव के लिए सही",
  rejected: "उपयुक्त नहीं",
  deltaT: "डेल्टा टी",
  wind: "हवा",
  temperature: "तापमान",
  humidity: "नमी",
  noHoursTitle: "कोई उपयुक्त समय नहीं",

  journalTitle: "फसल डायरी",
  journalPrompt: "आपके खेत पर क्या हुआ?",
  journalSprayed: "मैंने छिड़काव किया",
  journalSkipped: "मैं छिड़काव नहीं कर सका",
  journalObserved: "मैंने कुछ देखा",
  journalAddPhoto: "फ़ोटो जोड़ें",
  journalNote: "टिप्पणी जोड़ें",
  journalVoice: "आवाज़ में बताएँ",
  journalSave: "डायरी में सहेजें",
  journalSaved: "सहेज लिया। इससे अगले मौसम की सलाह आपके खेत के लिए और बेहतर होगी।",
  journalEmpty: "अभी कोई प्रविष्टि नहीं है। आपकी पहली टिप्पणी इस मौसम का रिकॉर्ड शुरू करेगी।",
  historyEmpty: "इस मौसम में अभी कुछ दर्ज नहीं है।",

  back: "वापस",
  retry: "फिर कोशिश करें",
  loading: "लोड हो रहा है",
  errorTitle: "कुछ गड़बड़ हुई",
  buildSprint: "आगामी चरण",
  dataLive: "लाइव डेटा",
  dataDemo: "डेमो डेटा",
  dataMixed: "मिश्रित डेटा",
  whereDataComes: "यह जानकारी कहाँ से आई",
  language: "भाषा",
};

const mr: Dict = {
  appName: "अ‍ॅग्रीसेन्स",
  tagline: "फवारणीसाठी योग्य सकाळ ओळखा",

  chatGreeting: "नमस्कार. मी तुम्हाला बायोस्टिम्युलंट फवारण्याची सर्वोत्तम वेळ सांगू शकतो.",
  chatAskCrop: "या शेतात कोणते पीक आहे?",
  chatAskLocation: "शेत कुठे आहे?",
  chatAskArea: "ते किती मोठे आहे?",
  chatAskSowing: "तुम्ही पेरणी कधी केली?",
  chatAskProduct: "तुमच्याकडे कोणते उत्पादन आहे?",
  chatWorking: "तुमच्या शेताचे हवामान तपासत आहे",
  cropRice: "भात",
  cropWheat: "गहू",
  cropCotton: "कापूस",
  acres: "एकर",
  weeksAgo: "आठवड्यांपूर्वी",
  monthsAgo: "महिन्यांपूर्वी",
  productStressBuster: "स्ट्रेस बस्टर",
  productYieldBooster: "यील्ड बूस्टर",
  useExisting: "माझे आधीचे शेत निवडा",

  sprayOn: "फवारणी करा",
  timeTo: "ते",
  readiness: "तयारी",
  need: "गरज",
  timing: "वेळ",
  conditions: "हवामान",
  valueEstimate: "अंदाजे वाचलेले मूल्य",
  modelEstimate: "अंदाज",
  valueBasis:
    "या वेळेत फवारणी आणि {days} दिवसांनी फवारणी यांची तुलना, {area} हेक्टरवर {stress} ताण दिवसांच्या आधारे.",
  setReminder: "आठवण ठेवा",
  reminderSet: "आठवण ठेवली",
  whyThisWindow: "ही वेळ का",
  doNotSpray: "अजून फवारणी करू नका.",
  checkAgain: "पुन्हा तपासा",
  remindMe: "बदल झाल्यास कळवा",
  openJournal: "हंगाम डायरी",
  seasonHistory: "हंगामाचा तपशील",

  whyTitle: "ही वेळ का",
  stressForecast: "पुढील 14 दिवसांचा ताण",
  onsetMarker: "ताण कृती पातळी ओलांडतो",
  recommendedWindow: "सुचवलेली वेळ",
  whatDrivesThis: "याचे कारण",
  notApplicable: "या पिकासाठी लागू नाही",

  hoursTitle: "तुमची वेळ निवडा",
  hoursSubtitle: "कारण पाहण्यासाठी कोणत्याही तासावर टॅप करा",
  viable: "फवारणीसाठी योग्य",
  rejected: "योग्य नाही",
  deltaT: "डेल्टा टी",
  wind: "वारा",
  temperature: "तापमान",
  humidity: "आर्द्रता",
  noHoursTitle: "योग्य वेळ नाही",

  journalTitle: "हंगाम डायरी",
  journalPrompt: "तुमच्या शेतावर काय घडले?",
  journalSprayed: "मी फवारणी केली",
  journalSkipped: "मला फवारणी करता आली नाही",
  journalObserved: "मला काही जाणवले",
  journalAddPhoto: "फोटो जोडा",
  journalNote: "टीप जोडा",
  journalVoice: "आवाजात सांगा",
  journalSave: "डायरीत जतन करा",
  journalSaved: "जतन केले. यामुळे पुढील हंगामाचा सल्ला तुमच्या शेतासाठी अधिक अचूक होईल.",
  journalEmpty: "अजून नोंद नाही. तुमची पहिली टीप या हंगामाची नोंद सुरू करेल.",
  historyEmpty: "या हंगामात अजून काही नोंदवलेले नाही.",

  back: "मागे",
  retry: "पुन्हा प्रयत्न करा",
  loading: "लोड होत आहे",
  errorTitle: "काहीतरी चूक झाली",
  buildSprint: "पुढील टप्पा",
  dataLive: "थेट माहिती",
  dataDemo: "डेमो माहिती",
  dataMixed: "मिश्र माहिती",
  whereDataComes: "ही माहिती कुठून आली",
  language: "भाषा",
};

export const dictionaries: Record<Language, Dict> = { en, hi, mr };

export function t(language: Language, key: keyof Dict): string {
  return dictionaries[language]?.[key] ?? en[key];
}

export const STRESS_LABELS: Record<Language, Record<string, string>> = {
  en: {
    heat_diurnal: "Daytime heat",
    heat_nocturnal: "Warm nights",
    frost: "Frost",
    drought: "Dry soil",
    yield_risk: "Yield risk",
  },
  hi: {
    heat_diurnal: "दिन की गर्मी",
    heat_nocturnal: "गर्म रातें",
    frost: "पाला",
    drought: "सूखी मिट्टी",
    yield_risk: "उपज जोखिम",
  },
  mr: {
    heat_diurnal: "दिवसाची उष्णता",
    heat_nocturnal: "उबदार रात्री",
    frost: "धुके",
    drought: "कोरडी माती",
    yield_risk: "उत्पादन धोका",
  },
};

export function stressLabel(language: Language, key: string | null): string {
  if (!key) return "";
  return STRESS_LABELS[language]?.[key] ?? STRESS_LABELS.en[key] ?? key;
}
