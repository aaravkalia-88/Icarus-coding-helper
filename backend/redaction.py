import re

# ponytail: PEM blocks over 8 KiB are outside this heuristic; raise the bound if needed.
PRIVATE_KEY = re.compile(
    r"-----BEGIN (?P<kind>(?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?)PRIVATE KEY-----"
    r"[\s\S]{0,8192}?"
    r"-----END (?P=kind)PRIVATE KEY-----"
)
TOKEN = re.compile(
    r"\b(?:hf_[A-Za-z0-9]{16,256}|sk-[A-Za-z0-9_-]{16,256}|"
    r"gh[pousr]_[A-Za-z0-9]{20,256}|AKIA[0-9A-Z]{16}|"
    r"AIza[0-9A-Za-z_-]{35})\b"
)
ASSIGNMENT = re.compile(
    r"\b((?:[A-Za-z0-9_]*[_-])?(?:api[_-]?key|access[_-]?token|secret[_-]?key)['\"]?\s*[:=]\s*['\"]?)"
    r"([A-Za-z0-9_./+=-]{16,256})(?![A-Za-z0-9_./+=-])",
    re.IGNORECASE,
)


def redact(text: str) -> str:
    text = PRIVATE_KEY.sub("[REDACTED PRIVATE KEY]", text)
    text = TOKEN.sub("[REDACTED CREDENTIAL]", text)
    return ASSIGNMENT.sub(lambda match: match.group(1) + "[REDACTED CREDENTIAL]", text)
