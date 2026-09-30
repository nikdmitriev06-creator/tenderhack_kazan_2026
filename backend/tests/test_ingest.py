import json
import zipfile
from itertools import islice
from pathlib import Path

import pytest

from app.ingest.profile import detect_role, profile_table
from app.ingest.readers import detect_encoding, read_tables

FAKE = Path(__file__).parent / "fixtures" / "fake"
STE_ROLES = {"id", "name", "category", "manufacturer", "characteristics"}


def only_table(path: Path):
    tables, skipped = read_tables(path)
    assert skipped == []
    assert len(tables) == 1
    return tables[0]


@pytest.mark.parametrize("name", ["ste.xlsx", "ste_cp1251.csv", "ste_headerless.csv", "ste.jsonl"])
def test_every_ste_format_gives_15_rows_and_all_roles(name: str) -> None:
    table = only_table(FAKE / name)
    prof = profile_table(table)
    assert prof.sampled == 15
    assert {c.role for c in prof.columns} >= STE_ROLES
    assert prof.characteristics is not None
    assert prof.characteristics.unparsed_segments == 0


def test_xlsx_trailing_empty_columns_dropped() -> None:
    assert len(only_table(FAKE / "ste.xlsx").columns) == 5


def test_headerless_csv_keeps_first_row() -> None:
    table = only_table(FAKE / "ste_headerless.csv")
    assert table.columns == ["col_1", "col_2", "col_3", "col_4", "col_5"]
    assert next(table.rows())["col_1"] == "91000001"


def test_encoding_detected_when_sample_cuts_a_letter() -> None:
    data = "Бумага офисная".encode()
    assert detect_encoding(data[:-1]) == "utf-8-sig"
    assert detect_encoding("Бумага".encode("cp1251")) == "cp1251"


def test_timestamp_column_is_date_not_characteristics() -> None:
    assert detect_role("col_4", ["2024-06-05 14:43:51.363", "2022-05-26 05:58:45.087"])[0] == "date"


def test_ktru_nested_json_is_found() -> None:
    tables, _ = read_tables(FAKE / "ktru.json")
    positions = next(t for t in tables if t.source.endswith("#positions"))
    prof = profile_table(positions)
    assert prof.column_for("ktru_code") == "code"
    assert prof.column_for("okpd2_code") == "okpd2"


def test_zip_archive_is_extracted_and_read(tmp_path: Path) -> None:
    archive = tmp_path / "dataset.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.write(FAKE / "ste_cp1251.csv", "Данные/СТЕ.csv")
    tables, _ = read_tables(archive)
    assert len(tables) == 1
    assert len(list(islice(tables[0].rows(), 100))) == 15
    assert (tmp_path / "dataset.zip.extracted").is_dir()


def test_ground_truth_codes_exist_in_ktru() -> None:
    codes = {
        p["code"] for p in json.loads((FAKE / "ktru.json").read_text(encoding="utf-8"))["positions"]
    }
    truth = json.loads((FAKE / "ground_truth.json").read_text(encoding="utf-8"))
    assert {t["ktru"] for t in truth if t["ktru"]} <= codes
    assert sum(bool(t["errors"]) for t in truth) >= 10
