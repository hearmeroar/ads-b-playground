import json

import app


def test_load_ui_config_applies_accordion_defaults(monkeypatch, tmp_path):
    custom = app._default_ui_config()
    custom["sidebar"]["accordion"]["default_collapsed"] = True
    custom["sidebar"]["accordion"]["groups"]["identity"] = False
    config_file = tmp_path / "ui.json"
    config_file.write_text(json.dumps(custom))
    monkeypatch.setattr(app, "UI_CONFIG_FILE", str(config_file))

    assert app._load_ui_config() == custom


def test_load_ui_config_applies_tile_layout_visibility(monkeypatch, tmp_path):
    custom = app._default_ui_config()
    custom["sidebar"]["tile_layout"] = {
        "visible": False,
        "enabled_by_default": False,
    }
    config_file = tmp_path / "ui.json"
    config_file.write_text(json.dumps(custom))
    monkeypatch.setattr(app, "UI_CONFIG_FILE", str(config_file))

    assert app._load_ui_config() == custom


def test_load_ui_config_applies_altitude_color_defaults(monkeypatch, tmp_path):
    custom = app._default_ui_config()
    custom["map"]["altitude_color"] = {
        "visible": False,
        "enabled_by_default": False,
    }
    config_file = tmp_path / "ui.json"
    config_file.write_text(json.dumps(custom))
    monkeypatch.setattr(app, "UI_CONFIG_FILE", str(config_file))

    assert app._load_ui_config() == custom


def test_load_ui_config_applies_airports_defaults(monkeypatch, tmp_path):
    custom = app._default_ui_config()
    custom["map"]["airports"] = {
        "enabled_by_default": False,
        "min_zoom": 12,
    }
    config_file = tmp_path / "ui.json"
    config_file.write_text(json.dumps(custom))
    monkeypatch.setattr(app, "UI_CONFIG_FILE", str(config_file))

    assert app._load_ui_config() == custom


def test_load_ui_config_falls_back_for_invalid_group_state(monkeypatch, tmp_path):
    config_file = tmp_path / "ui.json"
    config_file.write_text(json.dumps({
        "sidebar": {
            "accordion": {
                "default_collapsed": False,
                "groups": {"identity": "no"},
            },
        },
    }))
    monkeypatch.setattr(app, "UI_CONFIG_FILE", str(config_file))

    assert app._load_ui_config() == app._default_ui_config()
