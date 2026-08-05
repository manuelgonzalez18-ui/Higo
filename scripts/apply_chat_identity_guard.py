from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}\n--- needle ---\n{old}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


path = "src/components/ChatWidget.jsx"

replace_once(
    path,
    """            if (session?.user) {
                setUserId(session.user.id);
""",
    """            if (session?.user) {
                userIdRef.current = session.user.id;
                setUserId(session.user.id);
""",
)

replace_once(
    path,
    """            const nextUserId = user?.id || null;
            setUserId(nextUserId);
""",
    """            const nextUserId = user?.id || null;
            userIdRef.current = nextUserId;
            setUserId(nextUserId);
""",
)

replace_once(
    path,
    """        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            const nextUserId = session?.user?.id || null;
            setUserId(nextUserId);
""",
    """        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            const nextUserId = session?.user?.id || null;
            userIdRef.current = nextUserId;
            setUserId(nextUserId);
""",
)

replace_once(
    path,
    "        const syncStartedAt = new Date().toISOString();\n",
    "",
)
