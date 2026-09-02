from app.security import hash_password, verify_password


def test_hash_and_verify_password_roundtrip() -> None:
    hashed = hash_password("correct horse battery staple")
    assert verify_password(hashed, "correct horse battery staple") is True


def test_verify_rejects_wrong_password() -> None:
    hashed = hash_password("correct horse battery staple")
    assert verify_password(hashed, "wrong password") is False


def test_hash_is_not_plaintext() -> None:
    password = "correct horse battery staple"
    assert hash_password(password) != password
