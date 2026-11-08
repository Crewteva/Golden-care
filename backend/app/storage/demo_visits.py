"""Starter drug and diagnosis lists, and demo visit records (SEED_DEMO only).
The lists are examples for the review: the medical director edits them from "Drugs & diagnoses".
Every patient and visit here is invented."""
import logging
import random
from datetime import timedelta

import psycopg
from psycopg.types.json import Jsonb

from app.core.visits import allergy_hit

log = logging.getLogger(__name__)

# specialty key (as in demo_settings) or None for general, ICD-10 code, Arabic, English
DIAGNOSES = [
    ("derm", "L70.0", "حب الشباب", "Acne vulgaris"),
    ("derm", "L20.9", "إكزيما تأتبية", "Atopic dermatitis"),
    ("derm", "L81.1", "كلف", "Melasma"),
    ("derm", "L64.9", "تساقط الشعر الوراثي", "Androgenetic alopecia"),
    ("derm", "L63.9", "الثعلبة", "Alopecia areata"),
    ("derm", "L21.9", "التهاب الجلد الدهني", "Seborrheic dermatitis"),
    ("derm", "L40.0", "صدفية", "Psoriasis vulgaris"),
    ("derm", "B35.4", "فطريات الجلد", "Tinea corporis"),
    ("derm", "L50.9", "أرتيكاريا (حساسية جلدية)", "Urticaria"),
    ("derm", "L81.0", "تصبغات بعد الالتهاب", "Post-inflammatory hyperpigmentation"),
    ("derm", "B07", "ثآليل (سنط)", "Viral warts"),
    ("derm", "L71.9", "الوردية", "Rosacea"),
    ("derm", "L90.5", "ندبات حب الشباب", "Acne scars"),
    ("derm", "L57.0", "تقدّم الجلد بالشمس (تجاعيد)", "Photoaging"),
    ("laser", "L68.0", "زيادة الشعر (شعرانية)", "Hirsutism"),
    ("laser", "Z41.1", "إزالة شعر تجميلية", "Cosmetic hair removal"),
    ("dental", "K02.9", "تسوس الأسنان", "Dental caries"),
    ("dental", "K04.0", "التهاب العصب", "Pulpitis"),
    ("dental", "K04.7", "خراج حول قمة الجذر", "Periapical abscess"),
    ("dental", "K05.1", "التهاب اللثة", "Gingivitis"),
    ("dental", "K05.3", "التهاب دواعم السن", "Chronic periodontitis"),
    ("dental", "K01.1", "ضرس عقل مطمور", "Impacted wisdom tooth"),
    ("dental", "S02.5", "كسر في السن", "Fractured tooth"),
    ("dental", "K03.7", "تلون الأسنان", "Tooth discoloration"),
    ("dental", "K08.1", "فقد سن", "Missing tooth"),
    ("dental", "K03.8", "حساسية الأسنان", "Dentine hypersensitivity"),
    ("dental", "K03.6", "جير على الأسنان", "Dental calculus"),
    ("obgyn", "Z34.9", "متابعة حمل طبيعي", "Supervision of normal pregnancy"),
    ("obgyn", "B37.3", "فطريات مهبلية", "Vaginal candidiasis"),
    ("obgyn", "N76.0", "التهاب مهبلي بكتيري", "Bacterial vaginosis"),
    ("obgyn", "E28.2", "تكيس المبايض", "Polycystic ovary syndrome"),
    ("obgyn", "N94.6", "آلام الدورة", "Dysmenorrhea"),
    ("obgyn", "N92.0", "غزارة الدورة", "Menorrhagia"),
    ("obgyn", "N83.2", "كيس على المبيض", "Ovarian cyst"),
    ("obgyn", "O99.0", "أنيميا أثناء الحمل", "Anaemia in pregnancy"),
    ("obgyn", "Z30.0", "استشارة منع حمل", "Contraception counselling"),
    ("obgyn", "Z12.4", "مسحة دورية لعنق الرحم", "Cervical screening"),
    (None, "N39.0", "التهاب مسالك بولية", "Urinary tract infection"),
    (None, "I10", "ضغط دم مرتفع", "Essential hypertension"),
    (None, "E11.9", "سكري من النوع الثاني", "Type 2 diabetes"),
    (None, "D50.9", "أنيميا نقص الحديد", "Iron deficiency anaemia"),
    (None, "E55.9", "نقص فيتامين د", "Vitamin D deficiency"),
]

# name, generic, form, strength, dose, frequency, duration, restricted, allergy words
DRUGS = [
    ("Augmentin 1 g", "amoxicillin + clavulanic acid", "tablet", "1 g", "1 tablet", "every 12 hours", "7 days", False, ["penicillin", "amoxicillin", "بنسلين"]),
    ("Amoxil 500 mg", "amoxicillin", "capsule", "500 mg", "1 capsule", "every 8 hours", "7 days", False, ["penicillin", "amoxicillin", "بنسلين"]),
    ("Flagyl 500 mg", "metronidazole", "tablet", "500 mg", "1 tablet", "every 8 hours", "5 days", False, ["metronidazole"]),
    ("Zithromax 500 mg", "azithromycin", "tablet", "500 mg", "1 tablet", "once daily", "3 days", False, ["macrolide", "azithromycin"]),
    ("Ciprofar 500 mg", "ciprofloxacin", "tablet", "500 mg", "1 tablet", "every 12 hours", "5 days", False, ["quinolone", "ciprofloxacin"]),
    ("Vibramycin 100 mg", "doxycycline", "capsule", "100 mg", "1 capsule", "once daily", "6 weeks", False, ["tetracycline", "doxycycline"]),
    ("Monurol 3 g", "fosfomycin", "sachet", "3 g", "1 sachet", "once", "single dose", False, ["fosfomycin"]),
    ("Panadol 500 mg", "paracetamol", "tablet", "500 mg", "1–2 tablets", "every 6 hours if needed", "3 days", False, ["paracetamol"]),
    ("Brufen 400 mg", "ibuprofen", "tablet", "400 mg", "1 tablet", "every 8 hours after meals", "3 days", False, ["nsaid", "ibuprofen", "aspirin"]),
    ("Cataflam 50 mg", "diclofenac potassium", "tablet", "50 mg", "1 tablet", "every 12 hours after meals", "3 days", False, ["nsaid", "diclofenac", "aspirin"]),
    ("Ponstan forte 500 mg", "mefenamic acid", "tablet", "500 mg", "1 tablet", "every 8 hours during the period", "3 days", False, ["nsaid", "mefenamic"]),
    ("Ketolac 10 mg", "ketorolac", "tablet", "10 mg", "1 tablet", "every 8 hours if needed", "3 days", False, ["nsaid", "ketorolac"]),
    ("Alphintern", "trypsin + chymotrypsin", "tablet", None, "2 tablets", "every 8 hours", "5 days", False, []),
    ("Tramal 50 mg", "tramadol", "capsule", "50 mg", "1 capsule", "every 12 hours if needed", "3 days", True, ["tramadol", "opioid"]),
    ("Lyrica 75 mg", "pregabalin", "capsule", "75 mg", "1 capsule", "at night", "14 days", True, ["pregabalin"]),
    ("Xanax 0.25 mg", "alprazolam", "tablet", "0.25 mg", "1 tablet", "at night", "7 days", True, ["benzodiazepine", "alprazolam"]),
    ("Nexium 40 mg", "esomeprazole", "tablet", "40 mg", "1 tablet", "before breakfast", "14 days", False, ["esomeprazole"]),
    ("Antodine 20 mg", "famotidine", "tablet", "20 mg", "1 tablet", "every 12 hours", "7 days", False, []),
    ("Claritine 10 mg", "loratadine", "tablet", "10 mg", "1 tablet", "once daily", "14 days", False, ["loratadine"]),
    ("Zyrtec 10 mg", "cetirizine", "tablet", "10 mg", "1 tablet", "at night", "14 days", False, ["cetirizine"]),
    ("Telfast 180 mg", "fexofenadine", "tablet", "180 mg", "1 tablet", "once daily", "14 days", False, ["fexofenadine"]),
    ("Fucidin 2%", "fusidic acid", "cream", "2%", "thin layer", "twice daily", "7 days", False, ["fusidic"]),
    ("Fucicort", "fusidic acid + betamethasone", "cream", None, "thin layer", "twice daily", "7 days", False, ["fusidic", "corticosteroid"]),
    ("Bactroban 2%", "mupirocin", "ointment", "2%", "thin layer", "three times daily", "5 days", False, ["mupirocin"]),
    ("Betnovate 0.1%", "betamethasone valerate", "cream", "0.1%", "thin layer", "twice daily", "7 days", False, ["corticosteroid", "betamethasone"]),
    ("Dermovate 0.05%", "clobetasol propionate", "cream", "0.05%", "thin layer", "once daily", "2 weeks", False, ["corticosteroid", "clobetasol"]),
    ("Elica 0.1%", "mometasone furoate", "cream", "0.1%", "thin layer", "once daily", "2 weeks", False, ["corticosteroid", "mometasone"]),
    ("Differin 0.1%", "adapalene", "gel", "0.1%", "pea-sized amount", "at night", "3 months", False, ["retinoid", "adapalene"]),
    ("Epiduo", "adapalene + benzoyl peroxide", "gel", None, "pea-sized amount", "at night", "3 months", False, ["retinoid", "benzoyl"]),
    ("Benzac AC 5%", "benzoyl peroxide", "gel", "5%", "thin layer", "once daily", "2 months", False, ["benzoyl"]),
    ("Dalacin T 1%", "clindamycin", "solution", "1%", "apply", "twice daily", "2 months", False, ["clindamycin", "lincosamide"]),
    ("Acnotin 20 mg", "isotretinoin", "capsule", "20 mg", "1 capsule", "once daily with food", "1 month", True, ["retinoid", "isotretinoin"]),
    ("Daktarin 2%", "miconazole", "cream", "2%", "apply", "twice daily", "3 weeks", False, ["azole", "miconazole"]),
    ("Lamisil 1%", "terbinafine", "cream", "1%", "apply", "once daily", "2 weeks", False, ["terbinafine"]),
    ("Nizoral 2%", "ketoconazole", "shampoo", "2%", "lather 5 minutes then rinse", "twice weekly", "4 weeks", False, ["azole", "ketoconazole"]),
    ("Diflucan 150 mg", "fluconazole", "capsule", "150 mg", "1 capsule", "once weekly", "2 weeks", False, ["azole", "fluconazole"]),
    ("Regaine 5%", "minoxidil", "solution", "5%", "1 ml on the scalp", "twice daily", "6 months", False, ["minoxidil"]),
    ("Eldoquin Forte 4%", "hydroquinone", "cream", "4%", "thin layer on dark patches", "at night", "8 weeks", False, ["hydroquinone"]),
    ("Sunscreen SPF 50+", "broad-spectrum sunscreen", "cream", "SPF 50+", "apply generously", "every 3 hours in daylight", "ongoing", False, []),
    ("Bepanthen", "dexpanthenol", "ointment", "5%", "thin layer", "twice daily", "7 days", False, ["dexpanthenol"]),
    ("Zovirax 5%", "acyclovir", "cream", "5%", "apply", "five times daily", "5 days", False, ["acyclovir"]),
    ("Valtrex 500 mg", "valacyclovir", "tablet", "500 mg", "1 tablet", "every 12 hours", "5 days", False, ["acyclovir", "valacyclovir"]),
    ("Pridocaine", "lidocaine + prilocaine", "cream", "2.5% / 2.5%", "thick layer 45 minutes before the session", "before procedure", "as needed", False, ["lidocaine", "prilocaine", "local anaesthetic", "ليدوكايين"]),
    ("Hexitol", "chlorhexidine gluconate", "mouthwash", "0.125%", "10 ml rinse for 1 minute", "twice daily", "7 days", False, ["chlorhexidine"]),
    ("Kenacomb Orabase", "triamcinolone (oral paste)", "ointment", "0.1%", "dab on the ulcer", "three times daily", "5 days", False, ["corticosteroid", "triamcinolone"]),
    ("Sensodyne Rapid Relief", "potassium nitrate toothpaste", "other", None, "brush", "twice daily", "ongoing", False, []),
    ("Folic acid 0.5 mg", "folic acid", "tablet", "0.5 mg", "1 tablet", "once daily", "12 weeks", False, []),
    ("Feroglobin", "iron + vitamins", "capsule", None, "1 capsule", "once daily after meals", "3 months", False, ["iron"]),
    ("Osteocare", "calcium + vitamin D3", "tablet", None, "1 tablet", "once daily after meals", "3 months", False, []),
    ("Devarol-S 200,000 IU", "cholecalciferol", "solution", "200,000 IU", "1 ampoule by mouth", "once monthly", "3 months", False, ["cholecalciferol"]),
    ("Duphaston 10 mg", "dydrogesterone", "tablet", "10 mg", "1 tablet", "twice daily", "10 days", False, ["progestogen", "dydrogesterone"]),
    ("Prontogest 400 mg", "progesterone", "vaginal", "400 mg", "1 pessary", "at night", "14 days", False, ["progesterone"]),
    ("Canesten 500 mg", "clotrimazole", "vaginal", "500 mg", "1 vaginal tablet", "at night", "single dose", False, ["azole", "clotrimazole"]),
    ("Dalacin vaginal 2%", "clindamycin", "vaginal", "2%", "1 applicator", "at night", "7 nights", False, ["clindamycin", "lincosamide"]),
    ("Glucophage 500 mg", "metformin", "tablet", "500 mg", "1 tablet", "twice daily with meals", "3 months", False, ["metformin"]),
    ("Yasmin", "drospirenone + ethinylestradiol", "tablet", None, "1 tablet", "once daily", "21 days then 7-day break", False, ["estrogen"]),
    ("Cyclokapron 500 mg", "tranexamic acid", "tablet", "500 mg", "1 tablet", "every 8 hours during heavy days", "5 days", False, ["tranexamic"]),
    ("Navidoxine", "meclizine + pyridoxine", "tablet", None, "1 tablet", "at night", "2 weeks", False, ["meclizine"]),
    ("Clomid 50 mg", "clomiphene citrate", "tablet", "50 mg", "1 tablet", "once daily, day 2 to 6 of the cycle", "5 days", True, ["clomiphene"]),
]

# Demo visit templates per specialty: complaint, history, examination, diagnoses (English names), plan,
# prescription [(drug, instructions)], follow-up days, note for reception, summary for the patient.
TEMPLATES = {
    "derm": [
        ("Acne on the face and back for 6 months", "Tried over-the-counter washes without improvement. No regular medication.",
         "Comedones and inflammatory papules on cheeks, forehead and upper back. No nodules or scarring.",
         ["Acne vulgaris"], "Topical retinoid at night, oral doxycycline 6 weeks, gentle cleanser, daily sunscreen.",
         [("Epiduo", "طبقة رقيقة ليلًا على الوجه كله"), ("Vibramycin 100 mg", "بعد الأكل مع كوب ماء كامل"), ("Sunscreen SPF 50+", None)],
         42, "Review acne response after the antibiotic course",
         "حب الشباب متوسط. استخدم الجل ليلًا والكبسولات يوميًا لمدة ٦ أسابيع، مع واقي الشمس صباحًا. قد يزيد الاحمرار أول أسبوعين وهذا طبيعي."),
        ("Dark patches on both cheeks", "Started after last pregnancy, worse in summer.",
         "Symmetrical light-brown macules over malar area. Wood's lamp: epidermal pattern.",
         ["Melasma"], "Hydroquinone 4% at night for 8 weeks, strict sun protection; consider chemical peel after 2 months.",
         [("Eldoquin Forte 4%", "على البقع فقط ليلًا"), ("Sunscreen SPF 50+", "كل ٣ ساعات نهارًا")],
         56, "Assess for chemical peel",
         "عندك كلف. ضعي الكريم على البقع ليلًا لمدة ٨ أسابيع وواقي الشمس كل ٣ ساعات. سنقيّم بعدها جلسة تقشير."),
        ("Hair thinning over the crown", "Gradual over 2 years. Father bald. No recent illness.",
         "Miniaturisation over vertex, positive family history. Scalp healthy. Pull test negative.",
         ["Androgenetic alopecia"], "Minoxidil 5% twice daily; PRP sessions monthly x3; check ferritin and vitamin D.",
         [("Regaine 5%", "١ مل على فروة الرأس الجافة مرتين يوميًا")],
         30, "Book first PRP session",
         "تساقط شعر وراثي. استخدم المحلول مرتين يوميًا بانتظام، والنتيجة تظهر بعد ٣–٦ شهور. سنبدأ جلسات البلازما الشهر القادم."),
        ("Itchy red patches on the arms", "Worse with hot showers. History of asthma as a child.",
         "Ill-defined erythematous scaly plaques on flexures of both arms. Lichenification mild.",
         ["Atopic dermatitis"], "Moisturise twice daily, mometasone once daily 2 weeks, antihistamine at night.",
         [("Elica 0.1%", "مرة يوميًا على الأماكن الحمراء فقط"), ("Zyrtec 10 mg", "قبل النوم")],
         14, None,
         "إكزيما. ضع الكريم مرة يوميًا لمدة أسبوعين فقط، ومرطّب مرتين يوميًا، وقرص الحساسية قبل النوم."),
        ("Follow-up after chemical peel", "Second session done two weeks ago. Mild peeling resolved.",
         "Improved pigmentation, no post-inflammatory changes, skin intact.",
         ["Post-inflammatory hyperpigmentation"], "Continue sunscreen; next session in 4 weeks.",
         [("Bepanthen", "مرتين يوميًا لو فيه جفاف")],
         28, "Book next peel session",
         "الجلد استجاب جيدًا للجلسة. استمر على واقي الشمس، والجلسة القادمة بعد ٤ أسابيع."),
    ],
    "dental": [
        ("Pain in lower right molar when chewing", "Started 5 days ago, worse with cold drinks. No swelling.",
         "Deep carious lesion 46 occlusal-distal, tender to percussion, lingering pain to cold. X-ray: caries close to pulp.",
         ["Pulpitis", "Dental caries"], "Root canal treatment 46 in two sessions, then crown. Analgesic for pain.",
         [("Brufen 400 mg", "بعد الأكل عند الألم"), ("Hexitol", "مضمضة مرتين يوميًا")],
         7, "Second root canal session",
         "عندك التهاب في عصب الضرس. بدأنا علاج العصب، والجلسة الثانية بعد أسبوع. خذ المسكن بعد الأكل عند الحاجة."),
        ("Bleeding gums when brushing", "Brushes once daily. Smoker 10 cigarettes/day.",
         "Generalised marginal gingivitis, moderate calculus on lower anteriors. Pocket depths 3–4 mm.",
         ["Gingivitis", "Dental calculus"], "Full scaling and polishing done today. Oral hygiene instructions. Chlorhexidine 1 week.",
         [("Hexitol", "مضمضة دقيقة مرتين يوميًا بعد التفريش")],
         180, "Routine cleaning in 6 months",
         "تم تنظيف الجير. نزيف اللثة سيتحسن خلال أيام. فرّش مرتين يوميًا واستخدم الغسول لمدة أسبوع."),
        ("Swelling and pain upper left", "Throbbing pain 3 days, swelling since yesterday. Afebrile.",
         "Periapical abscess 26, buccal swelling, tooth tender. Drained through access cavity.",
         ["Periapical abscess"], "Antibiotic 7 days, analgesic, root canal 26 after swelling settles.",
         [("Augmentin 1 g", "بعد الأكل كل ١٢ ساعة"), ("Cataflam 50 mg", "بعد الأكل عند الألم")],
         5, "Start root canal 26",
         "عندك خراج في الضرس. خذ المضاد الحيوي كاملًا ٧ أيام. سنبدأ علاج العصب بعد زوال التورم."),
        ("Routine check-up", "No complaints. Last visit 1 year ago.",
         "Two small occlusal caries 36 and 37. Gingiva healthy.",
         ["Dental caries"], "Composite fillings 36 and 37 next session.",
         [],
         10, "Book two composite fillings",
         "أسنانك بحالة جيدة عمومًا. يوجد تسوس صغير في ضرسين نعالجه بحشو تجميلي في الجلسة القادمة."),
        ("Sensitivity to cold on front teeth", "After whitening strips bought online.",
         "Cervical abrasion 13–23, no caries. Gingival recession minimal.",
         ["Dentine hypersensitivity"], "Desensitising toothpaste, fluoride varnish applied.",
         [("Sensodyne Rapid Relief", "مرتين يوميًا بدون مضمضة بعدها مباشرة")],
         None, None,
         "حساسية في الأسنان بسبب منتجات التبييض. استخدم المعجون المخصص مرتين يوميًا وتجنب شرائط التبييض."),
    ],
    "obgyn": [
        ("Routine pregnancy follow-up", "G2P1, 24 weeks. Mild fatigue. No bleeding or pain.",
         "BP normal, fundal height appropriate. Ultrasound: single live fetus, normal growth, placenta posterior high.",
         ["Supervision of normal pregnancy", "Anaemia in pregnancy"], "Iron and calcium supplements, CBC in 4 weeks, glucose tolerance test at 26 weeks.",
         [("Feroglobin", "بعد الغداء"), ("Osteocare", "بعد العشاء")],
         28, "Pregnancy follow-up with ultrasound",
         "الحمل يسير بشكل طبيعي والجنين ينمو جيدًا. عندك أنيميا بسيطة: خذي الحديد يوميًا بعد الغداء والكالسيوم بعد العشاء."),
        ("Vaginal itching and discharge", "4 days. No fever. Not pregnant.",
         "White curdy discharge, vulval erythema. No pelvic tenderness.",
         ["Vaginal candidiasis"], "Single-dose clotrimazole pessary, oral fluconazole, hygiene advice.",
         [("Canesten 500 mg", "قرص مهبلي واحد قبل النوم"), ("Diflucan 150 mg", "كبسولة واحدة")],
         None, None,
         "عندك فطريات مهبلية بسيطة. ضعي القرص المهبلي ليلة واحدة وخذي الكبسولة. لو لم تتحسن الأعراض خلال أسبوع تواصلي معنا."),
        ("Irregular periods and acne", "Cycles 40–60 days for 2 years, weight gain 8 kg.",
         "BMI 29. Mild hirsutism. Ultrasound: multiple peripheral follicles both ovaries.",
         ["Polycystic ovary syndrome"], "Lifestyle advice, metformin, hormonal profile day 3, review with results.",
         [("Glucophage 500 mg", "مع الأكل مرتين يوميًا")],
         30, "Review hormone results",
         "عندك تكيس على المبايض. بدأنا علاج ينظم الهرمونات، مع نظام أكل ورياضة. أحضري نتائج التحاليل في الزيارة القادمة."),
        ("Painful periods", "Severe cramps first 2 days, missing work. Cycles regular.",
         "Pelvic examination and ultrasound normal.",
         ["Dysmenorrhea"], "NSAID from day 1 of period, heat, review in 3 months.",
         [("Ponstan forte 500 mg", "بعد الأكل من أول يوم للدورة")],
         None, None,
         "الفحص والسونار طبيعي. خذي المسكن بعد الأكل من أول يوم للدورة لمدة ٣ أيام."),
    ],
}


# Children (under 12) get their own stories; the summary is written for the parent.
CHILD_TEMPLATES = {
    "derm": [TEMPLATES["derm"][3]],
    "dental": [
        ("Check-up; pain with sweets on the lower left", "Brushes once a day with help. Sweets most days.",
         "Early caries 75 occlusal, deep fissures on 36 and 46. Gums healthy. Cooperative child.",
         ["Dental caries"], "Fluoride varnish today, fissure sealants 36 and 46, small filling 75 next session.",
         [], 14, "Sealants and filling 75 (child)",
         "يوجد تسوس بسيط في ضرس لبني. وضعنا فلورايد اليوم، وفي الجلسة القادمة نعمل سد شقوق وحشو صغير. قللوا الحلويات بين الوجبات وساعدوه في التفريش مرتين يوميًا."),
        ("Sealants and filling as planned", "No pain since last visit.",
         "Sealants placed on 36 and 46. Composite filling 75 done. Good cooperation.",
         ["Dental caries"], "Recall in 6 months with fluoride varnish.",
         [], 180, "Six-month check-up (child)",
         "تم سد الشقوق والحشو بنجاح. لا يحتاج أدوية. نراه بعد ٦ شهور للكشف الدوري والفلورايد."),
    ],
}


def seed_clinical_lists(conn: psycopg.Connection) -> None:
    if not conn.execute("SELECT 1 FROM diagnoses LIMIT 1").fetchone():
        specs = {r["name_en"]: r["id"] for r in conn.execute("SELECT id, name_en FROM specialties")}
        keys = {"derm": "Dermatology & cosmetics", "laser": "Laser", "dental": "Dental", "obgyn": "Obstetrics & gynecology"}
        for order, (spec, code, ar, en) in enumerate(DIAGNOSES):
            conn.execute(
                "INSERT INTO diagnoses (specialty_id, code, name_ar, name_en, sort_order) VALUES (%s, %s, %s, %s, %s)",
                (specs.get(keys.get(spec)), code, ar, en, order),
            )
    if not conn.execute("SELECT 1 FROM drugs LIMIT 1").fetchone():
        for name, generic, form, strength, dose, freq, duration, restricted, tags in DRUGS:
            conn.execute(
                """
                INSERT INTO drugs (name, generic_name, form, strength, default_dose, default_frequency, default_duration,
                                   restricted, allergy_tags)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (name, generic, form, strength, dose, freq, duration, restricted, tags),
            )


def seed_demo_visits(conn: psycopg.Connection) -> None:
    if conn.execute("SELECT 1 FROM visits LIMIT 1").fetchone():
        return
    rng = random.Random(4)
    nurse = conn.execute("SELECT id FROM users WHERE email = 'nurse@demo.goldencare.local'").fetchone()
    drugs = {r["name"]: r for r in conn.execute("SELECT * FROM drugs")}
    diagnoses = {r["name_en"]: r for r in conn.execute("SELECT * FROM diagnoses")}
    portal_family = {r["id"] for r in conn.execute(
        """
        SELECT p.id FROM patients p WHERE p.user_id IS NOT NULL
        UNION SELECT f.patient_id FROM patient_family f JOIN patients g ON g.id = f.relative_id
        WHERE g.user_id IS NOT NULL AND f.is_guardian AND f.removed_at IS NULL
        """)}
    done = conn.execute(
        """
        SELECT a.*, u.email, p.gender, date_part('year', age(a.starts_at::date, p.date_of_birth))::int AS age
        FROM appointments a JOIN users u ON u.id = a.doctor_id JOIN patients p ON p.id = a.patient_id
        WHERE a.status = 'completed' ORDER BY a.starts_at
        """
    ).fetchall()
    count = 0
    last_story: dict = {}
    for appt in done:
        local = appt["email"].split("@")[0].replace("dr.", "")
        templates = TEMPLATES.get(local)
        if not templates or (local == "obgyn" and appt["gender"] != "female"):
            continue  # those appointments simply have no demo note; the doctor can still open one
        child = appt["age"] < 12
        if child:
            templates = CHILD_TEMPLATES.get(local, templates)
        if appt["gender"] != "female":
            templates = [t for t in templates if "pregnan" not in (t[0] + t[1]).lower()]
        # the same patient doesn't get the same story twice in a row
        fresh = [t for t in templates if t[0] != last_story.get(appt["patient_id"])] or templates
        story = fresh[0] if child else rng.choice(fresh)
        last_story[appt["patient_id"]] = story[0]
        complaint, history, exam, dx_names, plan, rx, follow_days, follow_note, summary = story
        if child:  # no adult tablets for children in the demo
            rx = [(n, i) for n, i in rx if drugs.get(n) and drugs[n]["form"] in ("cream", "gel", "ointment", "mouthwash", "other")]
        started = appt["in_room_at"] or appt["starts_at"]
        signed = appt["completed_at"] or appt["ends_at"]
        dx = [{"diagnosis_id": diagnoses[n]["id"], "code": diagnoses[n]["code"], "name_ar": diagnoses[n]["name_ar"],
               "name_en": diagnoses[n]["name_en"], "text": None} for n in dx_names if n in diagnoses]
        visit = conn.execute(
            """
            INSERT INTO visits (appointment_id, patient_id, doctor_id, branch_id, complaint, history, examination, diagnoses, plan,
                                follow_up_days, follow_up_note, started_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
            """,
            (appt["id"], appt["patient_id"], appt["doctor_id"], appt["branch_id"], complaint, history, exam, Jsonb(dx), plan,
             follow_days, follow_note, started),
        ).fetchone()["id"]
        alerts = conn.execute(
            "SELECT kind, description FROM patient_alerts WHERE patient_id = %s AND removed_at IS NULL", (appt["patient_id"],),
        ).fetchall()
        position = 0
        for name, instructions in rx:
            drug = drugs.get(name)
            if not drug or allergy_hit(alerts, drug):
                continue  # the demo never prescribes against a recorded allergy
            conn.execute(
                """
                INSERT INTO visit_rx_items (visit_id, position, drug_id, drug_name, generic_name, form, strength, dose, frequency,
                                            duration, instructions)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (visit, position, drug["id"], drug["name"], drug["generic_name"], drug["form"], drug["strength"],
                 drug["default_dose"], drug["default_frequency"], drug["default_duration"], instructions),
            )
            position += 1
        release = appt["patient_id"] in portal_family or rng.random() < 0.5
        conn.execute(
            """
            UPDATE visits SET status = 'signed', signed_at = %(signed)s, patient_summary = %(summary)s,
                   released_at = CASE WHEN %(release)s THEN %(signed)s::timestamptz + interval '20 minutes' END,
                   released_by = CASE WHEN %(release)s THEN doctor_id END, updated_at = %(signed)s
            WHERE id = %(id)s
            """,
            {"signed": signed, "summary": summary if release else None, "release": release, "id": visit},
        )
        if nurse and rng.random() < 0.75:
            female = appt["gender"] == "female"
            if appt["age"] < 16:
                weight, height = round(rng.uniform(22, 48), 1), round(rng.uniform(118, 158), 1)
            elif female:
                weight, height = round(rng.uniform(55, 78), 1), round(rng.uniform(155, 170), 1)
            else:
                weight, height = round(rng.uniform(62, 95), 1), round(rng.uniform(165, 185), 1)
            conn.execute(
                """
                INSERT INTO vitals (patient_id, appointment_id, recorded_by, recorded_at, bp_systolic, bp_diastolic, pulse,
                                    temperature, spo2, weight_kg, height_cm)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (appt["patient_id"], appt["id"], nurse["id"], (appt["arrived_at"] or started) + timedelta(minutes=3),
                 rng.randint(105, 138), rng.randint(65, 88), rng.randint(64, 96), round(rng.uniform(36.4, 37.2), 1),
                 rng.randint(96, 99), weight, height),
            )
        count += 1
    log.info("Demo visits created: %s", count)
