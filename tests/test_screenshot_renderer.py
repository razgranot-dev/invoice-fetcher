"""Tests for core.screenshot_renderer."""
import os
import pytest
from unittest.mock import patch, MagicMock
from core.screenshot_renderer import (
    build_html_template,
    generate_filename,
    is_minimal_body,
    _autocrop_whitespace,
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
        assert name.endswith(".png")

    def test_no_amount(self):
        name = generate_filename("2024-01-15", "Vendor", None)
        assert name == "2024-01-15_Vendor.png"

    def test_truncates_long_vendor(self):
        name = generate_filename("2024-01-15", "A" * 100, 50.0)
        assert len(name) <= 120

    def test_hebrew_vendor_transliterated(self):
        name = generate_filename("2024-01-15", "חשבונית מספר 123", 50.0)
        # Should contain only ASCII chars
        assert all(ord(c) < 128 for c in name), f"Non-ASCII in filename: {name}"
        assert name.endswith(".png")

    def test_empty_vendor_gets_default(self):
        name = generate_filename("2024-01-15", "", 50.0)
        assert "email" in name
        assert name.endswith(".png")

    def test_mixed_hebrew_english(self):
        name = generate_filename("2024-01-15", "Google חשבון Cloud", 100.0)
        assert all(ord(c) < 128 for c in name), f"Non-ASCII in filename: {name}"


class TestIsMinimalBody:
    def test_short_text_is_minimal(self):
        assert is_minimal_body("see attached invoice") is True

    def test_long_text_is_not_minimal(self):
        assert is_minimal_body("x" * 200) is False

    def test_empty_is_minimal(self):
        assert is_minimal_body("") is True

    def test_see_attached_pattern(self):
        assert is_minimal_body("Please find the attached invoice for your records.") is True


class TestAutocropWhitespace:
    def test_crops_trailing_whitespace(self, tmp_path):
        """Verify that _autocrop_whitespace trims white area below content."""
        from PIL import Image

        # Create a 800x16384 white image with a colored block at the top
        img = Image.new("RGB", (800, 16384), (255, 255, 255))
        # Draw a non-white block in the top 200px
        for y in range(200):
            for x in range(800):
                img.putpixel((x, y), (0, 0, 0))

        path = str(tmp_path / "test.png")
        img.save(path)

        _autocrop_whitespace(path, padding=32)

        cropped = Image.open(path)
        # Should be trimmed to ~200 + 32 padding = 232px, not the full viewport
        assert cropped.height <= 300
        assert cropped.height >= 200
        cropped.close()

    def test_leaves_small_images_unchanged(self, tmp_path):
        """If content fills the whole image, no unnecessary crop."""
        from PIL import Image

        img = Image.new("RGB", (800, 400), (100, 100, 100))
        path = str(tmp_path / "small.png")
        img.save(path)

        _autocrop_whitespace(path, padding=32)

        result = Image.open(path)
        assert result.height == 400  # unchanged, all non-white
        result.close()

    def test_handles_missing_file_gracefully(self):
        """Should not raise on non-existent file."""
        _autocrop_whitespace("/nonexistent/path.png")  # should just log and return
