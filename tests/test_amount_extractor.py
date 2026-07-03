"""Tests for core.amount_extractor."""
import pytest
from core.amount_extractor import extract_amount, extract_description


class TestExtractAmount:
    def test_shekel_symbol_before(self):
        result = extract_amount("הסכום לתשלום: ₪89.00")
        assert result["amount"] == 89.00
        # extract_amount returns ISO 4217 codes, not symbols (the web layer's
        # normalizeCurrency expects ISO). ₪ → "ILS".
        assert result["currency"] == "ILS"
        assert result["confidence"] == "high"

    def test_shekel_symbol_after(self):
        result = extract_amount("סה\"כ 142.50 ₪ כולל מע\"מ")
        assert result["amount"] == 142.50
        assert result["confidence"] == "high"

    def test_shekel_text_shekel(self):
        result = extract_amount("חיוב של 310.00 ש\"ח")
        assert result["amount"] == 310.00
        assert result["confidence"] == "high"

    def test_english_dollar(self):
        result = extract_amount("Total: $67.30")
        assert result["amount"] == 67.30
        assert result["currency"] == "USD"
        assert result["confidence"] == "high"

    def test_labeled_amount_hebrew(self):
        result = extract_amount("סכום: 250.00")
        assert result["amount"] == 250.00
        assert result["confidence"] == "medium"

    def test_takes_largest_amount(self):
        text = "פריט א: ₪50.00\nפריט ב: ₪30.00\nסה\"כ: ₪80.00"
        result = extract_amount(text)
        assert result["amount"] == 80.00

    def test_no_amount_found(self):
        result = extract_amount("הודעה ללא סכום כספי")
        assert result["amount"] is None
        assert result["confidence"] == "low"

    def test_empty_string(self):
        result = extract_amount("")
        assert result["amount"] is None
        assert result["confidence"] == "low"

    def test_integer_amount(self):
        result = extract_amount("₪100")
        assert result["amount"] == 100.0

    def test_comma_thousands(self):
        result = extract_amount("₪1,250.00")
        assert result["amount"] == 1250.00

    def test_euro_symbol(self):
        result = extract_amount("Total: €12.99")
        assert result["amount"] == 12.99
        assert result["currency"] == "EUR"
        assert result["confidence"] == "high"

    def test_euro_code(self):
        result = extract_amount("Amount due EUR 49.00")
        assert result["amount"] == 49.00
        assert result["currency"] == "EUR"

    def test_gbp_symbol(self):
        result = extract_amount("You paid £8.50")
        assert result["amount"] == 8.50
        assert result["currency"] == "GBP"

    def test_labeled_total_beats_larger_marketing_number(self):
        # A "save $100" marketing line must NOT win over the labeled total.
        text = "You saved $100 this month! Total: $9.99"
        result = extract_amount(text)
        assert result["amount"] == 9.99
        assert result["currency"] == "USD"

    def test_bare_integer_after_label_is_ignored(self):
        # "Total items: 2026" is a count, not a charged amount — the decimal
        # requirement on unlabeled-symbol-less totals keeps it out.
        result = extract_amount("Total items: 2026")
        assert result["amount"] is None

    def test_labeled_total_wins_over_item_prices(self):
        text = "Item A $50.00\nItem B $30.00\nTotal: $80.00"
        result = extract_amount(text)
        assert result["amount"] == 80.00


class TestExtractDescription:
    def test_cleans_re_prefix(self):
        assert extract_description("Re: חשבונית חודשית", "") == "חשבונית חודשית"

    def test_cleans_fwd_prefix(self):
        assert extract_description("Fwd: Invoice #123", "") == "Invoice #123"

    def test_cleans_hebrew_prefix(self):
        assert extract_description("השב: חשבונית", "") == "חשבונית"

    def test_fallback_to_sender(self):
        assert extract_description("", "Hostinger <billing@hostinger.com>") == "Hostinger"

    def test_sender_name_extraction(self):
        assert extract_description("", "John Doe <john@example.com>") == "John Doe"

    def test_sender_email_only(self):
        assert extract_description("", "billing@hostinger.com") == "billing@hostinger.com"
