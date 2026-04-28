import json
import streamlit as st
import psycopg2
import psycopg2.extras

st.set_page_config(
    page_title="Agent Dialog Viewer",
    page_icon="💬",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown("""
<style>
/* Chat bubbles */
.stChatMessage { border-radius: 12px; }

/* Record header bar */
.record-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0 2px 0;
    color: #6b7280;
    font-size: 0.82rem;
    border-top: 1px solid #e5e7eb;
    margin-top: 8px;
}
.record-index {
    background: #4F46E5;
    color: white;
    border-radius: 50%;
    width: 22px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.72rem;
    font-weight: bold;
    flex-shrink: 0;
}

/* Tool call / result blocks */
.tool-call-block {
    background: #fffbeb;
    border-left: 3px solid #f59e0b;
    padding: 8px 12px;
    margin: 6px 0;
    border-radius: 0 6px 6px 0;
    font-size: 0.88rem;
}
.tool-result-block {
    background: #ecfdf5;
    border-left: 3px solid #10b981;
    padding: 8px 12px;
    margin: 6px 0;
    border-radius: 0 6px 6px 0;
    font-size: 0.88rem;
}
.thinking-block {
    background: #f0f0ff;
    border-left: 3px solid #818cf8;
    padding: 8px 12px;
    margin: 6px 0;
    border-radius: 0 6px 6px 0;
    font-size: 0.88rem;
}

/* Session info card */
.info-card {
    background: #f8f9fc;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    padding: 16px 20px;
    margin-bottom: 16px;
}
.info-label { color: #6b7280; font-size: 0.78rem; }
.info-value { font-weight: 600; font-size: 0.95rem; }
</style>
""", unsafe_allow_html=True)


# ──────────────────────────────────────────────────────────────
# Database helpers
# ──────────────────────────────────────────────────────────────

def _build_dsn(cfg: dict) -> dict:
    return dict(
        host=cfg["host"],
        port=int(cfg["port"]),
        dbname=cfg["dbname"],
        user=cfg["user"],
        password=cfg["password"],
        connect_timeout=10,
        client_encoding="UTF8",
    )


def test_connection(cfg: dict) -> str | None:
    """Return None on success, error string on failure."""
    try:
        conn = psycopg2.connect(**_build_dsn(cfg))
        conn.close()
        return None
    except Exception as exc:
        return str(exc)


def get_connection(cfg: dict):
    return psycopg2.connect(**_build_dsn(cfg))


def load_defaults_from_secrets() -> dict:
    try:
        s = st.secrets["db"]
        return {
            "host": s.get("host", "localhost"),
            "port": s.get("port", 5432),
            "dbname": s.get("dbname", ""),
            "user": s.get("user", ""),
            "password": s.get("password", ""),
        }
    except Exception:
        return {"host": "localhost", "port": 5432, "dbname": "", "user": "", "password": ""}


# ──────────────────────────────────────────────────────────────
# Message-chain renderer
# ──────────────────────────────────────────────────────────────

def _render_content_block(block: dict):
    """Render a single Anthropic-style content block."""
    btype = block.get("type", "text")

    if btype == "text":
        text = block.get("text", "")
        if text.strip():
            st.markdown(text)

    elif btype == "thinking":
        thinking = block.get("thinking", "")
        with st.expander("🧠 Thinking", expanded=False):
            st.markdown(f"<div class='thinking-block'>{thinking}</div>", unsafe_allow_html=True)

    elif btype == "tool_use":
        name = block.get("name", "unknown_tool")
        tool_id = block.get("id", "")
        inp = block.get("input", {})
        st.markdown(
            f"<div class='tool-call-block'>🔧 <strong>Tool call:</strong> "
            f"<code>{name}</code> &nbsp;<span style='color:#9ca3af'>id={tool_id}</span></div>",
            unsafe_allow_html=True,
        )
        if inp:
            st.json(inp, expanded=False)

    elif btype == "tool_result":
        tool_use_id = block.get("tool_use_id", "")
        result_content = block.get("content", "")
        st.markdown(
            f"<div class='tool-result-block'>✅ <strong>Tool result</strong> "
            f"<span style='color:#9ca3af'>id={tool_use_id}</span></div>",
            unsafe_allow_html=True,
        )
        if isinstance(result_content, list):
            for rb in result_content:
                if isinstance(rb, dict) and rb.get("type") == "text":
                    txt = rb.get("text", "")
                    if len(txt) > 2000:
                        with st.expander("Show full result"):
                            st.code(txt, language=None)
                    else:
                        st.code(txt, language=None)
        elif isinstance(result_content, str):
            if len(result_content) > 2000:
                with st.expander("Show full result"):
                    st.code(result_content, language=None)
            else:
                st.code(result_content, language=None)

    else:
        st.json(block, expanded=False)


def render_message_chain(messages_json: str):
    """Parse and render the full agent message chain."""
    try:
        messages = json.loads(messages_json)
    except (json.JSONDecodeError, TypeError):
        st.text(messages_json[:2000] if messages_json else "(empty)")
        return

    if not isinstance(messages, list) or not messages:
        st.info("No messages in chain.")
        return

    for msg in messages:
        role = msg.get("role", "unknown")
        content = msg.get("content", "")

        if role == "system":
            with st.expander("⚙️ System prompt", expanded=False):
                if isinstance(content, str):
                    st.markdown(content)
                elif isinstance(content, list):
                    for block in content:
                        _render_content_block(block)
            continue

        avatar = None
        if role == "user":
            chat_role = "user"
        elif role == "assistant":
            chat_role = "assistant"
        else:
            # tool / unknown – render as assistant with wrench avatar
            chat_role = "assistant"
            avatar = "🔧"

        with st.chat_message(chat_role, avatar=avatar):
            if isinstance(content, str):
                if content.strip():
                    st.markdown(content)
            elif isinstance(content, list):
                for block in content:
                    if isinstance(block, dict):
                        _render_content_block(block)
                    else:
                        st.write(block)
            else:
                st.write(content)


# ──────────────────────────────────────────────────────────────
# UI helpers
# ──────────────────────────────────────────────────────────────

def _safe_json(val: str):
    try:
        return json.loads(val)
    except Exception:
        return None


def _label(text: str, value: str):
    if value and value not in ("null", "None", ""):
        st.markdown(
            f"<span class='info-label'>{text}</span><br>"
            f"<span class='info-value'>{value}</span>",
            unsafe_allow_html=True,
        )


def render_session_card(session: dict):
    st.markdown("<div class='info-card'>", unsafe_allow_html=True)
    c1, c2, c3, c4 = st.columns(4)
    with c1:
        _label("Session ID", session.get("session_id", ""))
        _label("User ID", session.get("user_id", ""))
    with c2:
        _label("Title", session.get("title", ""))
        _label("Task Type", session.get("task_type", ""))
    with c3:
        _label("Mode", session.get("mode", ""))
        _label("Question Type", session.get("question_type", ""))
    with c4:
        _label("Created", session.get("create_time", ""))
        _label("Updated", session.get("update_time", ""))

    extras = {}
    for f in ("ticket_id", "active_skill_ids", "pending_proxy", "evidence", "site_info"):
        v = session.get(f)
        if v and v not in ("null", "None", ""):
            extras[f] = v
    if extras:
        st.markdown("<br>", unsafe_allow_html=True)
        with st.expander("More fields"):
            for k, v in extras.items():
                parsed = _safe_json(v)
                if parsed is not None:
                    st.markdown(f"**{k}**")
                    st.json(parsed, expanded=False)
                else:
                    st.markdown(f"**{k}:** {v}")
    st.markdown("</div>", unsafe_allow_html=True)


def render_record(idx: int, record: dict, view_mode: str):
    question = record.get("question") or ""
    answer = record.get("answer") or ""
    messages_raw = record.get("messages") or ""
    create_time = record.get("create_time") or ""
    model_name = record.get("model_name") or ""
    like = record.get("like") or ""
    hate = record.get("hate") or ""

    feedback_icons = ""
    if like and like not in ("0", "null", "None", ""):
        feedback_icons += " 👍"
    if hate and hate not in ("0", "null", "None", ""):
        feedback_icons += " 👎"

    st.markdown(
        f"<div class='record-header'>"
        f"<span class='record-index'>{idx + 1}</span>"
        f"<span>{create_time}</span>"
        f"{'&nbsp;·&nbsp;<code>' + model_name + '</code>' if model_name else ''}"
        f"{'&nbsp;' + feedback_icons if feedback_icons else ''}"
        f"</div>",
        unsafe_allow_html=True,
    )

    has_messages = bool(messages_raw and messages_raw not in ("null", "None", "[]", ""))

    if view_mode == "full" and has_messages:
        render_message_chain(messages_raw)
    else:
        # Simple Q&A view
        if question:
            with st.chat_message("user"):
                st.markdown(question)
        if answer:
            with st.chat_message("assistant"):
                st.markdown(answer)
        if view_mode == "full" and not has_messages:
            st.caption("No detailed message chain stored for this record.")

    # Metadata expander
    meta = {}
    meta_fields = [
        "question_id", "answer_id", "task_type", "lang", "version",
        "vector_topk", "text_topk", "rerank_topk", "kb_id",
        "use_slow_sql_prompt", "user_type", "slow_sql_node",
        "backup_diag_step", "feedback_info", "hate_info", "report_type",
        "report_info", "model_config",
    ]
    for f in meta_fields:
        v = record.get(f)
        if v and v not in ("null", "None", "", "0"):
            meta[f] = v

    if meta:
        with st.expander("Record metadata", expanded=False):
            left, right = st.columns(2)
            items = list(meta.items())
            mid = (len(items) + 1) // 2
            for col, chunk in ((left, items[:mid]), (right, items[mid:])):
                with col:
                    for k, v in chunk:
                        parsed = _safe_json(v)
                        if parsed is not None:
                            st.markdown(f"**{k}**")
                            st.json(parsed, expanded=False)
                        else:
                            st.markdown(f"**{k}:** `{v}`")


# ──────────────────────────────────────────────────────────────
# Sidebar – DB configuration
# ──────────────────────────────────────────────────────────────

defaults = load_defaults_from_secrets()

with st.sidebar:
    st.title("⚙️ Database")

    with st.form("db_form"):
        host = st.text_input("Host", value=st.session_state.get("db_host", defaults["host"]))
        port = st.number_input("Port", value=int(st.session_state.get("db_port", defaults["port"])), step=1, min_value=1, max_value=65535)
        dbname = st.text_input("Database", value=st.session_state.get("db_name", defaults["dbname"]))
        user = st.text_input("User", value=st.session_state.get("db_user", defaults["user"]))
        password = st.text_input("Password", type="password", value=st.session_state.get("db_pass", defaults["password"]))
        submitted = st.form_submit_button("Connect", use_container_width=True)

    if submitted:
        cfg = dict(host=host, port=port, dbname=dbname, user=user, password=password)
        err = test_connection(cfg)
        if err:
            st.error(f"Connection failed: {err}")
            st.session_state.pop("db_cfg", None)
        else:
            st.session_state.db_cfg = cfg
            st.session_state.db_host = host
            st.session_state.db_port = port
            st.session_state.db_name = dbname
            st.session_state.db_user = user
            st.session_state.db_pass = password
            st.success("Connected ✓")

    if "db_cfg" in st.session_state:
        st.success("✓ Connected")

    st.divider()
    st.caption("Tip: put credentials in `.streamlit/secrets.toml` to skip this form.")


# ──────────────────────────────────────────────────────────────
# Main content
# ──────────────────────────────────────────────────────────────

st.title("💬 Agent Dialog Viewer")
st.caption("Input a session ID to replay the full conversation history stored in qa_session / qa_record.")

# Auto-connect from secrets if not yet connected
if "db_cfg" not in st.session_state and all(defaults[k] for k in ("dbname", "user")):
    cfg = dict(host=defaults["host"], port=defaults["port"],
               dbname=defaults["dbname"], user=defaults["user"],
               password=defaults["password"])
    err = test_connection(cfg)
    if not err:
        st.session_state.db_cfg = cfg

col_input, col_btn = st.columns([5, 1])
with col_input:
    session_id = st.text_input(
        "Session ID",
        label_visibility="collapsed",
        placeholder="Enter session_id …",
        key="session_id_input",
    )
with col_btn:
    search = st.button("Load", use_container_width=True, type="primary")

if session_id and search:
    if "db_cfg" not in st.session_state:
        st.warning("Please configure and connect to the database first (sidebar).")
        st.stop()

    with st.spinner("Fetching data …"):
        try:
            conn = get_connection(st.session_state.db_cfg)
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT * FROM qa_session WHERE session_id = %s LIMIT 1",
                    (session_id,),
                )
                session_row = cur.fetchone()

                cur.execute(
                    "SELECT * FROM qa_record WHERE session_id = %s ORDER BY create_time ASC",
                    (session_id,),
                )
                records = cur.fetchall()
            conn.close()
        except Exception as exc:
            st.error(f"Query failed: {exc}")
            st.stop()

    if session_row is None:
        st.warning(f"No session found for ID: `{session_id}`")
        st.stop()

    # ── Session info ──────────────────────────────────────────
    with st.expander("📋 Session Info", expanded=True):
        render_session_card(dict(session_row))

    # ── Records ───────────────────────────────────────────────
    st.markdown(f"### Conversation &nbsp; <span style='color:#6b7280;font-size:0.9rem'>({len(records)} records)</span>", unsafe_allow_html=True)

    if not records:
        st.info("No records found for this session.")
        st.stop()

    has_any_messages = any(
        r.get("messages") and r.get("messages") not in ("null", "None", "[]", "")
        for r in records
    )

    view_mode = st.radio(
        "View mode",
        options=["simple", "full"],
        format_func=lambda x: "Simple (Q&A only)" if x == "simple" else "Full agent chain (messages field)",
        horizontal=True,
        disabled=not has_any_messages,
        help="Full mode renders the complete agent message chain including tool calls and tool results." if has_any_messages else "No message chain data stored for this session.",
    )

    st.markdown("---")

    for i, record in enumerate(records):
        render_record(i, dict(record), view_mode)
