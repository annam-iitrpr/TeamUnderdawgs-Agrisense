"""Turning a score decomposition into a sentence a farmer can act on.

The agronomic decision is already made by the time anything here runs. These engines
only phrase it. The template engine is the default, is fully deterministic, and is
the only one used when no Gemini key is present. Gemini never sees raw weather, only
the finished decomposition, and it may not add, remove or alter a single fact.
"""

from __future__ import annotations

import contextlib
import logging
from datetime import date as Date
from datetime import datetime
from typing import Any, Protocol

from agrisense.agronomy.scoring import Readiness
from agrisense.config import Settings, get_settings

log = logging.getLogger(__name__)

STRESS_NAMES: dict[str, dict[str, str]] = {
    "en": {
        "heat_diurnal": "daytime heat",
        "heat_nocturnal": "warm nights",
        "frost": "frost",
        "drought": "dry soil",
        "yield_risk": "yield risk",
    },
    "hi": {
        "heat_diurnal": "दिन की गर्मी",
        "heat_nocturnal": "गर्म रातें",
        "frost": "पाला",
        "drought": "सूखी मिट्टी",
        "yield_risk": "उपज जोखिम",
    },
    "mr": {
        "heat_diurnal": "दिवसाची उष्णता",
        "heat_nocturnal": "उबदार रात्री",
        "frost": "धुके",
        "drought": "कोरडी माती",
        "yield_risk": "उत्पादन धोका",
    },
}

TEMPLATES: dict[str, dict[str, str]] = {
    "en": {
        "recommend": "{stress} is building on your field. Spray between {start} and {end} on {date}, while the air is still cool enough for the spray to reach the leaf.",
        "recover": "Your field is already under {stress}. Spray between {start} and {end} on {date} to help the crop hold on and recover.",
        "wait": "Do not spray yet. {reason}",
        "check_again": "Check again on {date}.",
    },
    "hi": {
        "recommend": "आपके खेत पर {stress} बढ़ रही है। {date} को {start} से {end} के बीच छिड़काव करें, जब हवा इतनी ठंडी हो कि दवा पत्ती तक पहुँच सके।",
        "recover": "आपके खेत पर {stress} पहले से शुरू हो चुकी है। फसल को सँभलने में मदद के लिए {date} को {start} से {end} के बीच छिड़काव करें।",
        "wait": "अभी छिड़काव न करें। {reason}",
        "check_again": "{date} को फिर से देखें।",
    },
    "mr": {
        "recommend": "तुमच्या शेतात {stress} वाढत आहे. {date} रोजी {start} ते {end} दरम्यान फवारणी करा, जेव्हा हवा पुरेशी थंड असते आणि फवारा पानापर्यंत पोहोचतो.",
        "recover": "तुमच्या शेतात {stress} आधीच सुरू झाली आहे. पीक सावरण्यासाठी {date} रोजी {start} ते {end} दरम्यान फवारणी करा.",
        "wait": "अजून फवारणी करू नका. {reason}",
        "check_again": "{date} रोजी पुन्हा तपासा.",
    },
}

WAIT_REASONS: dict[str, dict[str, str]] = {
    "en": {
        "no_hours": "Rain is expected in every window that would otherwise work.",
        "too_soon": "The stress arrives too soon for the product to protect the crop in time.",
        "no_stress": "No stress is expected on your field in the coming days.",
        "wrong_stage": "Your crop is not at a stage where this product will help.",
    },
    "hi": {
        "no_hours": "हर उपयुक्त समय में बारिश की संभावना है।",
        "too_soon": "गर्मी इतनी जल्दी आ रही है कि दवा समय पर काम नहीं कर पाएगी।",
        "no_stress": "आने वाले दिनों में आपके खेत पर कोई तनाव नहीं दिख रहा है।",
        "wrong_stage": "आपकी फसल अभी उस अवस्था में नहीं है जहाँ यह दवा काम करे।",
    },
    "mr": {
        "no_hours": "प्रत्येक योग्य वेळेत पावसाची शक्यता आहे.",
        "too_soon": "ताण इतक्या लवकर येत आहे की औषध वेळेत काम करणार नाही.",
        "no_stress": "येत्या दिवसांत तुमच्या शेतावर कोणताही ताण दिसत नाही.",
        "wrong_stage": "तुमचे पीक अशा अवस्थेत नाही जिथे हे औषध उपयोगी पडेल.",
    },
}

MONTHS: dict[str, list[str]] = {
    "en": [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ],
    "hi": [
        "जनवरी",
        "फ़रवरी",
        "मार्च",
        "अप्रैल",
        "मई",
        "जून",
        "जुलाई",
        "अगस्त",
        "सितंबर",
        "अक्टूबर",
        "नवंबर",
        "दिसंबर",
    ],
    "mr": [
        "जानेवारी",
        "फेब्रुवारी",
        "मार्च",
        "एप्रिल",
        "मे",
        "जून",
        "जुलै",
        "ऑगस्ट",
        "सप्टेंबर",
        "ऑक्टोबर",
        "नोव्हेंबर",
        "डिसेंबर",
    ],
}


def format_date(value: datetime | Date, language: str = "en") -> str:
    """Day and month in the requested language, for example 14 अगस्त."""
    months = MONTHS.get(language, MONTHS["en"])
    return f"{value.day} {months[value.month - 1]}"


def classify_block(blocked_reason: str | None) -> str:
    """Map the engine's blocking reason onto a phrasing key."""
    text = (blocked_reason or "").lower()
    if "too soon" in text:
        return "too_soon"
    if "not effective at that stage" in text or "yield critical window" in text:
        return "wrong_stage"
    if "no stress" in text:
        return "no_stress"
    return "no_hours"


FACTOR_TEMPLATES: dict[str, dict[str, str]] = {
    "en": {
        "onset": "{stress} is projected to reach {value} out of 9 on {date}.",
        "lead_time": "Applying {days} days ahead gives the crop time to respond before the stress arrives.",
        "already_started": "The stress has already started, so this application is to help the crop recover rather than to protect it in advance.",
        "window_conditions": "Between {start} and {end} the air is humid enough that the droplet reaches the leaf instead of evaporating.",
        "hours_rejected": "{rejected} of the {total} hours checked were ruled out, mostly because the air was too dry or rain was too close.",
        "stage": "The crop is at {stage}, a stage where this product is effective.",
    },
    "hi": {
        "onset": "{date} को {stress} 9 में से {value} तक पहुँचने का अनुमान है।",
        "lead_time": "{days} दिन पहले छिड़काव करने से फसल को तनाव आने से पहले सँभलने का समय मिलता है।",
        "already_started": "तनाव पहले ही शुरू हो चुका है, इसलिए यह छिड़काव बचाव के लिए नहीं बल्कि फसल को सँभलने में मदद के लिए है।",
        "window_conditions": "{start} से {end} के बीच हवा में इतनी नमी रहती है कि दवा उड़ने के बजाय पत्ती तक पहुँचती है।",
        "hours_rejected": "जाँचे गए {total} घंटों में से {rejected} घंटे छोड़ दिए गए, ज़्यादातर इसलिए कि हवा बहुत सूखी थी या बारिश बहुत पास थी।",
        "stage": "फसल {stage} अवस्था में है, जहाँ यह उत्पाद असरदार होता है।",
    },
    "mr": {
        "onset": "{date} रोजी {stress} 9 पैकी {value} पर्यंत पोहोचण्याचा अंदाज आहे.",
        "lead_time": "{days} दिवस आधी फवारणी केल्याने पिकाला ताण येण्यापूर्वी सावरण्यास वेळ मिळतो.",
        "already_started": "ताण आधीच सुरू झाला आहे, त्यामुळे ही फवारणी आगाऊ संरक्षणासाठी नसून पीक सावरण्यास मदत करण्यासाठी आहे.",
        "window_conditions": "{start} ते {end} दरम्यान हवेत पुरेशी आर्द्रता असते, त्यामुळे फवारा उडून न जाता पानापर्यंत पोहोचतो.",
        "hours_rejected": "तपासलेल्या {total} तासांपैकी {rejected} तास वगळले गेले, बहुतांशी हवा खूप कोरडी होती किंवा पाऊस खूप जवळ होता म्हणून.",
        "stage": "पीक {stage} अवस्थेत आहे, जिथे हे उत्पादन प्रभावी ठरते.",
    },
}

STAGE_NAMES: dict[str, dict[str, str]] = {
    "en": {
        "establishment": "establishment",
        "tillering": "tillering",
        "panicle_initiation": "panicle_initiation",
        "heading": "heading",
        "grain_fill": "grain_fill",
        "jointing": "jointing",
        "vegetative": "vegetative",
        "match_head_square": "match_head_square",
        "flowering": "flowering",
        "boll_fill": "boll_fill",
        "maturity": "maturity",
    },
    "hi": {
        "establishment": "स्थापना",
        "tillering": "कल्ले फूटना",
        "panicle_initiation": "बाली बनना",
        "heading": "बाली निकलना",
        "grain_fill": "दाना भरना",
        "jointing": "गाँठ बनना",
        "vegetative": "बढ़वार",
        "match_head_square": "स्क्वायर बनना",
        "flowering": "फूल आना",
        "boll_fill": "बॉल भरना",
        "maturity": "पकाई",
    },
    "mr": {
        "establishment": "स्थापना",
        "tillering": "फुटवे येणे",
        "panicle_initiation": "ओंबी तयार होणे",
        "heading": "ओंबी बाहेर पडणे",
        "grain_fill": "दाणे भरणे",
        "jointing": "कांडी धरणे",
        "vegetative": "वाढ",
        "match_head_square": "स्क्वेअर तयार होणे",
        "flowering": "फुले येणे",
        "boll_fill": "बोंडे भरणे",
        "maturity": "परिपक्वता",
    },
}


def format_factors(factors: list[dict[str, Any]], language: str = "en") -> list[str]:
    """Render the structured factors into sentences in the requested language."""
    lang = language if language in FACTOR_TEMPLATES else "en"
    templates = FACTOR_TEMPLATES[lang]
    stress_names = STRESS_NAMES.get(lang, STRESS_NAMES["en"])
    stage_names = STAGE_NAMES.get(lang, {})

    out: list[str] = []
    for factor in factors:
        template = templates.get(str(factor.get("key")))
        if not template:
            continue
        values = dict(factor)
        if "stress_type" in values:
            values["stress"] = stress_names.get(str(values["stress_type"]), str(values["stress_type"]).replace("_", " "))
        if "date" in values:
            with contextlib.suppress(ValueError):
                values["date"] = format_date(datetime.fromisoformat(str(values["date"])), lang)
        if "stage" in values:
            raw_stage = str(values["stage"])
            values["stage"] = stage_names.get(raw_stage, raw_stage.replace("_", " "))
        try:
            out.append(template.format(**values))
        except KeyError:
            continue

    return out


class ExplanationEngine(Protocol):
    name: str

    async def explain(self, result: Readiness, language: str = "en") -> str: ...


class TemplateExplanationEngine:
    """Deterministic phrasing assembled from the score decomposition."""

    name = "template"

    async def explain(self, result: Readiness, language: str = "en") -> str:
        lang = language if language in TEMPLATES else "en"
        templates = TEMPLATES[lang]

        if not result.actionable and result.window is None:
            cause = classify_block(result.blocked_reason)
            reason = WAIT_REASONS.get(lang, WAIT_REASONS["en"])[cause]
            text = templates["wait"].format(reason=reason)
            if result.check_again_on:
                text += " " + templates["check_again"].format(date=format_date(result.check_again_on, lang))
            return text

        stress_names = STRESS_NAMES.get(lang, STRESS_NAMES["en"])
        stress = stress_names.get(result.driving_stress or "heat_diurnal")

        key = "recover" if result.timing_fit <= 0.45 else "recommend"
        return templates[key].format(
            stress=stress,
            start=result.window.start.strftime("%H:%M"),
            end=result.window.end.strftime("%H:%M"),
            date=format_date(result.window.start, lang),
        )


class GeminiExplanationEngine:
    """Rephrases the template output more naturally. It rewrites, it does not reason."""

    name = "gemini"

    def __init__(self, settings: Settings | None = None, timeout: float = 2.0) -> None:
        self.settings = settings or get_settings()
        self.timeout = timeout
        self.fallback = TemplateExplanationEngine()

    async def explain(self, result: Readiness, language: str = "en") -> str:
        baseline = await self.fallback.explain(result, language)

        if not self.settings.gemini_available:
            return baseline

        decomposition = {
            "readiness_score": result.readiness_score,
            "need": result.need,
            "timing_fit": result.timing_fit,
            "viability": result.viability,
            "driving_stress": result.driving_stress,
            "actionable": result.actionable,
            "factors": result.factors,
            "baseline_sentence": baseline,
        }

        prompt = (
            f"Rewrite the baseline sentence below so it sounds natural to an Indian smallholder farmer reading in language code {language}"
            ". You may not add, remove or alter any fact, number, date or time. Do not add advice that is not present. Do not use em dashes. Return one or two short sentences and nothing else.\n\nDecomposition: "
            f"{decomposition}"
        )

        try:
            import httpx

            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{self.settings.gemini_model}:generateContent",
                    headers={"x-goog-api-key": self.settings.gemini_api_key},
                    json={"contents": [{"parts": [{"text": prompt}]}]},
                )
                response.raise_for_status()
                payload = response.json()
                text = payload["candidates"][0]["content"]["parts"][0]["text"].strip()
                return text.replace("—", ",") if text else baseline
        except Exception as exc:
            log.warning("Gemini rephrasing failed, using the template: %s", exc)
            return baseline


def get_explanation_engine(settings: Settings | None = None) -> ExplanationEngine:
    settings = settings or get_settings()
    if settings.gemini_available:
        return GeminiExplanationEngine(settings)
    return TemplateExplanationEngine()
