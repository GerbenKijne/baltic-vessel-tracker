def test_app_imports_and_registers_routes() -> None:
    # No other test imports app.main directly, so a broken router
    # registration (missing dependency, bad decorator, etc.) would
    # otherwise only surface when the container actually starts.
    from app.main import app

    assert len(app.routes) > 10
