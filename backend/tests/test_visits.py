import pytest
from pydantic import ValidationError

from app.core.visit_schemas import RxItemIn, VitalsIn
from app.core.visits import allergy_hit

AUGMENTIN = {"name": "Augmentin 1 g", "generic_name": "amoxicillin + clavulanic acid", "allergy_tags": ["penicillin", "بنسلين"]}
PRIDOCAINE = {"name": "Pridocaine", "generic_name": "lidocaine + prilocaine", "allergy_tags": ["lidocaine"]}
PANADOL = {"name": "Panadol 500 mg", "generic_name": "paracetamol", "allergy_tags": []}


def alert(text, kind="allergy"):
    return {"kind": kind, "description": text}


def test_allergy_word_matches():
    assert allergy_hit([alert("Penicillin — rash and lip swelling (2019)")], AUGMENTIN) == "Penicillin — rash and lip swelling (2019)"


def test_allergy_arabic_word_matches():
    assert allergy_hit([alert("حساسية من البنسلين")], AUGMENTIN)


def test_active_ingredient_matches_without_tags():
    assert allergy_hit([alert("Amoxicillin — hives")], {**AUGMENTIN, "allergy_tags": []})


def test_unrelated_allergy_does_not_match():
    assert allergy_hit([alert("Latex"), alert("Penicillin")], PANADOL) is None


def test_only_allergy_alerts_count():
    assert allergy_hit([alert("Warfarin; avoid lidocaine with adrenaline", kind="medication")], PRIDOCAINE) is None


def test_vitals_ranges():
    with pytest.raises(ValidationError):
        VitalsIn(appointment_id="x", temperature=47)
    with pytest.raises(ValidationError):
        VitalsIn(appointment_id="x", spo2=120)
    assert VitalsIn(appointment_id="x", bp_systolic=120, bp_diastolic=80).pulse is None


def test_prescription_line_needs_dose_frequency_duration():
    with pytest.raises(ValidationError):
        RxItemIn(drug_id=1, dose="", frequency="daily", duration="5 days")
    assert RxItemIn(drug_id=1, dose="1 tablet", frequency="every 8 hours", duration="5 days").instructions is None
