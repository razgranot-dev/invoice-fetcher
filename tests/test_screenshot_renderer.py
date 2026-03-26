"""Tests for core.screenshot_renderer."""
import pytest
from core.screenshot_renderer import (
    build_html_template,
    generate_filename,
    is_minimal_body,
)


class TestBuildHtmlTemplate:
    def test_wraps_html_body(self):
        result = build_html_template("<p>Hello</p>")
        assert "<p>Hello</p>" in result
        assert "<!DOCTYPE html>" in result
        assert "direction: rtl" in result

    def test_includes_utf8_meta(self):
        result = build_html_template("<p>שלום</p>")
        assert "utf-8" in result.lower()

    def test_plain_text_wrapped_in_pre(self):
        result = build_html_template("", plain_text="Plain content here")
        assert "Plain content here" in result


class TestGenerateFilename:
    def test_basic_filename(self):
        name = generate_filename("2024-01-15", "Hostinger", 89.0)
        assert name == "2024-01-15_Hostinger_89.00.png"

    def test_sanitizes_special_chars(self):
        name = generate_filename("2024-01-15", "Google/Cloud <billing>", 142.5)
        assert "/" not in name
        assert "<" not in name
        assert ">" not in name

    def test_no_amount(self):
        name = generate_filename("2024-01-15", "Vendor", None)
        assert name == "2024-01-15_Vendor.png"

    def test_truncates_long_vendor(self):
        name = generate_filename("2024-01-15", "A" * 100, 50.0)
        assert len(name) <= 120


class TestIsMinimalBody:
    def test_short_text_is_minimal(self):
        assert is_minimal_body("see attached invoice") is True

    def test_long_text_is_not_minimal(self):
        assert is_minimal_body("x" * 200) is False

    def test_empty_is_minimal(self):
        assert is_minimal_body("") is True

    def test_see_attached_pattern(self):
        assert is_minimal_body("Please find the attached invoice for your records.") is True
