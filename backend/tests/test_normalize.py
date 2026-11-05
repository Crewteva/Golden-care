from app.core.normalize import normalize_email, normalize_name, normalize_phone


def test_egyptian_mobile_formats_are_the_same_number():
    expected = "+201001110001"
    for raw in ["01001110001", "+20 100 111 0001", "00201001110001", "201001110001", "1001110001",
                "010-0111-0001", "٠١٠٠١١١٠٠٠١"]:
        assert normalize_phone(raw) == expected, raw


def test_non_mobile_numbers_are_rejected():
    for raw in ["0223456789", "01301110001", "12345", "", None, "0100111000"]:
        assert normalize_phone(raw) is None, raw


def test_arabic_name_spellings_match():
    assert normalize_name("أحمد") == normalize_name("احمد")
    assert normalize_name("فاطمة") == normalize_name("فاطمه")
    assert normalize_name("مُحَمَّد") == normalize_name("محمد")
    assert normalize_name("هـــدى") == normalize_name("هدى")
    assert normalize_name("  Omar   YOUSSEF ") == "omar youssef"


def test_email_is_trimmed_and_lowercased():
    assert normalize_email("  Karim@Example.COM ") == "karim@example.com"
    assert normalize_email("not-an-email") is None
    assert normalize_email("a@b") is None
