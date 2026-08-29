import json
import hashlib
import os
import re
import socket
import threading
import atexit
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import quote, unquote, urljoin, urlparse
from urllib.request import Request, urlopen


PLATFORM_CONFIG: dict[str, dict[str, Any]] = {
    "csdn": {
        "auth_url": "https://mp.csdn.net/mp_blog/manage/article",
        "login_url": "https://passport.csdn.net/login",
        "account_url": "https://mp.csdn.net/mp_blog/manage/article",
        "editor_url": "https://editor.csdn.net/md/?not_checkout=1",
        "editor_hosts": ["editor.csdn.net"],
        "manager_url": "https://mp.csdn.net/mp_blog/manage/article",
        "login_markers": ["passport.csdn.net", "login"],
        "title": ["xpath://input[contains(@placeholder,'文章标题')]", "css:input.title-input"],
        "content": ["css:pre.editor__inner[contenteditable='true']", "css:.CodeMirror textarea", "xpath://div[contains(@class,'CodeMirror')]//textarea"],
        "publish": ["xpath://button[contains(normalize-space(.),'发布文章')]", "xpath://button[contains(normalize-space(.),'发布')]"],
        "confirm": [
            "xpath://button[contains(concat(' ',normalize-space(@class),' '),' btn-b-red ') and normalize-space(.)='发布文章']",
            "xpath://button[contains(normalize-space(.),'确认发布')]",
            "xpath://button[contains(normalize-space(.),'确定并发布')]",
        ],
        "tag_selected": ["xpath://span[contains(concat(' ',normalize-space(@class),' '),' el-tag ') and normalize-space(.)={{value}}]"],
        "success_markers": ["发布成功", "审核中", "发布完成"],
        "publish_response_targets": ["blog-console-api", "saveArticle", "publishArticle"],
        "published_markers": ["已发布", "发布成功"],
        "review_markers": ["审核中", "等待审核", "平台审核"],
        "public_pattern": r"https://blog\.csdn\.net/[^/]+/article/details/\d+",
        "article_id_pattern": r"(?:article/details/|articleId=)(\d+)",
        "account_name": ["css:.user-name", "css:.user-info .name", "css:[class*='userName']"],
        "account_link": [
            "css:a.csdn-profile-avatar[href*='blog.csdn.net/']",
            "css:a.hasAvatar[href*='blog.csdn.net/']",
            "xpath://a[contains(@href,'blog.csdn.net/') and string-length(substring-after(@href,'blog.csdn.net/')) > 0][1]",
            "css:a.user-name",
        ],
        "account_avatar": ["css:a.csdn-profile-avatar img", "css:.user-avatar img", "css:img.avatar"],
    },
    "juejin": {
        "auth_url": "https://juejin.cn/creator/home",
        "login_url": "https://juejin.cn/login",
        "account_url": "https://juejin.cn/creator/home",
        "editor_url": "https://juejin.cn/editor/drafts/new?v=2",
        "editor_hosts": ["juejin.cn"],
        "manager_url": "https://juejin.cn/creator/content/article/essays?status=all",
        "login_markers": ["login", "passport"],
        "title": ["xpath://input[contains(@placeholder,'输入文章标题')]", "css:input.title-input"],
        "content": ["css:.bytemd-editor textarea", "css:.CodeMirror textarea", "xpath://textarea"],
        "publish": ["xpath://button[normalize-space(.)='发布']"],
        "confirm": ["xpath://button[contains(normalize-space(.),'确定并发布')]", "xpath://button[contains(normalize-space(.),'确认发布')]"],
        "tag_input": ["css:.tag-input.select input.byte-select__input"],
        "tag_option": [
            "xpath://li[contains(concat(' ',normalize-space(@class),' '),' byte-select-option ') and normalize-space(.)={{value}}]"
        ],
        "tag_selected": [
            "xpath://div[contains(@class,'form-item') and .//div[contains(@class,'label') and contains(normalize-space(.),'添加标签')]]//span[contains(concat(' ',normalize-space(@class),' '),' byte-select__tag ') and normalize-space(.)={{value}}]"
        ],
        "success_markers": ["发布成功", "审核中", "文章发布成功"],
        "publish_response_targets": ["content_api/v1/article/publish"],
        "published_markers": ["已发布", "发布成功"],
        "review_markers": ["审核中", "等待审核", "平台审核"],
        "public_pattern": r"https://juejin\.cn/post/[A-Za-z0-9]+",
        "article_id_pattern": r"(?:post/|drafts/)([A-Za-z0-9]+)",
        "account_name": ["css:.user-name", "css:[class*='user-name']", "css:[class*='username']"],
        "account_link": ["xpath://a[contains(@href,'/user/')][1]", "css:a.user-name"],
        "account_avatar": ["css:img.avatar", "css:img.avatar-img", "css:[class*='avatar'] img"],
    },
    "zhihu": {
        "auth_url": "https://www.zhihu.com/creator",
        "login_url": "https://www.zhihu.com/signin",
        "account_url": "https://www.zhihu.com/creator",
        "editor_url": "https://zhuanlan.zhihu.com/write",
        "editor_hosts": ["zhuanlan.zhihu.com"],
        "manager_url": "https://www.zhihu.com/creator/manage/creation/article",
        "login_markers": ["/signin", "login"],
        "title": ["xpath://textarea[contains(@placeholder,'请输入标题')]", "css:textarea.WriteIndex-titleInput"],
        "content": ["css:.DraftEditor-root", "xpath://div[contains(@class,'DraftEditor-root')]"],
        "publish": ["xpath://button[normalize-space(.)='发布']"],
        "confirm": ["xpath://button[contains(normalize-space(.),'确认发布')]"],
        "success_markers": ["发布成功", "审核中", "已提交"],
        "publish_response_targets": ["api/v4/articles", "zhuanlan.zhihu.com/api/articles", "/publish"],
        "published_markers": ["已发布", "发布成功"],
        "review_markers": ["审核中", "等待审核", "平台审核"],
        "public_pattern": r"https://zhuanlan\.zhihu\.com/p/\d+",
        "article_id_pattern": r"/p/(\d+)",
        "account_name": ["css:.AppHeader-profile .Popover", "css:[class*='Creator'] [class*='name']", "css:[class*='Profile'] [class*='name']"],
        "account_link": [
            "css:a.AppHeader-profileAvatar[href*='/people/']",
            "xpath://a[contains(@class,'AppHeader-profileAvatar') and contains(@href,'/people/')][1]",
            "css:.AppHeader-profile a[href*='/people/']",
        ],
        "account_avatar": ["css:a.AppHeader-profileAvatar img", "css:.AppHeader-profile img", "css:img.Avatar"],
    },
}

CHALLENGE_MARKERS = ["验证码", "安全验证", "手机号验证", "手机确认", "captcha", "security challenge", "滑块"]
ERROR_PAGE_MARKERS = ["page not found", "页面不存在", "网页不存在", "页面未找到", "找不到页面"]
PLATFORM_LOCKS: dict[str, threading.Lock] = {}
PLATFORM_BROWSERS: dict[str, Any] = {}
PLATFORM_AUTH_TABS: dict[str, Any] = {}
TRANSIENT_BROWSER_ERRORS = {"BrowserConnectError", "PageDisconnectedError", "ContextLostError"}


def has_security_challenge(text: str) -> bool:
    normalized = text.lower()
    return any(marker.lower() in normalized for marker in CHALLENGE_MARKERS)


def is_transient_browser_error(error: Exception) -> bool:
    return type(error).__name__ in TRANSIENT_BROWSER_ERRORS


def _profile_root() -> Path:
    configured = os.environ.get("JOTO_PUBLISH_PROFILE_ROOT", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    local_data = os.environ.get("LOCALAPPDATA", "").strip()
    if local_data:
        return (Path(local_data) / "JotoPublishProfiles").resolve()
    return (Path.home() / ".joto-publish-profiles").resolve()


def _profile_key(platform: str, profile_ref: str | None = None) -> str:
    normalized = str(profile_ref or "").strip()
    if normalized and not re.fullmatch(r"[a-zA-Z0-9_-]{8,191}", normalized):
        raise ValueError("profileRef must be an opaque identifier")
    return f"{platform}:{normalized or 'legacy-default'}"


def _profile_lock(platform: str, profile_ref: str | None = None) -> threading.Lock:
    key = _profile_key(platform, profile_ref)
    if key not in PLATFORM_LOCKS:
        PLATFORM_LOCKS[key] = threading.Lock()
    return PLATFORM_LOCKS[key]


def profile_dir(platform: str, profile_ref: str | None = None) -> Path:
    env_name = f"{platform.upper()}_BROWSER_PROFILE_DIR"
    configured = os.environ.get(env_name, "").strip()
    normalized = str(profile_ref or "").strip()
    path = (
        (_profile_root() / platform / normalized).resolve()
        if normalized
        else Path(configured).expanduser().resolve() if configured else (_profile_root() / platform).resolve()
    )
    repository_root = Path(__file__).resolve().parents[2]
    if path == repository_root or repository_root in path.parents:
        raise ValueError(f"{env_name} must be outside the repository")
    path.mkdir(parents=True, exist_ok=True)
    return path


def _config(platform: str) -> dict[str, Any]:
    config = dict(PLATFORM_CONFIG[platform])
    config.setdefault("login_url", config["auth_url"])
    config.setdefault("account_url", config["auth_url"])
    config.setdefault("selector_version", "2026-07-29-v1")
    config.setdefault("category_option", [])
    config.setdefault("category_selected", [])
    config.setdefault("tag_option", [])
    config.setdefault("tag_selected", [])
    config.setdefault("tag_input", ["xpath://input[contains(@placeholder,'标签')]", "xpath://input[contains(@placeholder,'搜索')]"])
    raw = os.environ.get(f"ARCS_{platform.upper()}_SELECTORS_JSON", "").strip()
    if raw:
        value = json.loads(raw)
        if isinstance(value, dict):
            config.update(value)
            if "auth_url" in value:
                if "login_url" not in value:
                    config["login_url"] = value["auth_url"]
                if "account_url" not in value:
                    config["account_url"] = value["auth_url"]
    return config


def browser_executable_path() -> Path | None:
    configured = os.environ.get("ARCS_BROWSER_PATH", "").strip()
    if configured:
        path = Path(configured).expanduser().resolve()
        if not path.is_file():
            raise RuntimeError("ARCS_BROWSER_PATH must point to an existing Chromium browser executable")
        return path

    candidates = [
        Path(os.environ.get("PROGRAMFILES(X86)", "C:/Program Files (x86)")) / "Microsoft/Edge/Application/msedge.exe",
        Path(os.environ.get("PROGRAMFILES", "C:/Program Files")) / "Google/Chrome/Application/chrome.exe",
    ]
    local_app_data = os.environ.get("LOCALAPPDATA", "").strip()
    if local_app_data:
        candidates.append(Path(local_app_data) / "Google/Chrome/Application/chrome.exe")
    return next((path.resolve() for path in candidates if path.is_file()), None)


def _browser(platform: str, profile_ref: str | None = None):
    try:
        from DrissionPage import Chromium, ChromiumOptions
    except ImportError as error:
        raise RuntimeError("DrissionPage is not installed; run `uv sync` in arcs-runner") from error

    key = _profile_key(platform, profile_ref)
    cached = PLATFORM_BROWSERS.get(key)
    if cached is not None:
        try:
            if cached.states.is_alive:
                return cached
        except Exception:
            pass
        PLATFORM_BROWSERS.pop(key, None)

    options = ChromiumOptions()
    executable_path = browser_executable_path()
    if executable_path:
        options.set_browser_path(str(executable_path))
    if profile_ref:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as port_socket:
            port_socket.bind(("127.0.0.1", 0))
            default_port = int(port_socket.getsockname()[1])
    else:
        default_port = 9330 + list(PLATFORM_CONFIG).index(platform)
    browser_port = int(os.environ.get(f"ARCS_{platform.upper()}_BROWSER_PORT", str(default_port))) if not profile_ref else default_port
    options.set_local_port(browser_port)
    options.set_user_data_path(str(profile_dir(platform, profile_ref)))
    options.set_argument("--start-maximized")
    options.headless(False)
    browser = None
    for attempt in range(2):
        try:
            browser = Chromium(addr_or_opts=options)
            break
        except Exception as error:
            if type(error).__name__ != "BrowserConnectError" or attempt == 1:
                raise
            # The first launch can outlive DrissionPage's connection timeout.
            # Give that same dedicated browser one bounded chance to become ready.
            time.sleep(2)
    if browser is None:
        raise RuntimeError("browser initialization returned no browser")
    PLATFORM_BROWSERS[key] = browser
    return browser


def _close_cached_browsers() -> None:
    for browser in list(PLATFORM_BROWSERS.values()):
        try:
            browser.quit()
        except Exception:
            pass
    PLATFORM_BROWSERS.clear()
    PLATFORM_AUTH_TABS.clear()


atexit.register(_close_cached_browsers)


def _first(tab, selectors: list[str], timeout: float = 2):
    for selector in selectors:
        element = tab.ele(selector, timeout=timeout)
        if element:
            return element
    return None


def _first_displayed(tab, selectors: list[str], timeout: float = 2):
    for selector in selectors:
        try:
            elements = tab.eles(selector, timeout=timeout)
        except (AttributeError, TypeError):
            element = tab.ele(selector, timeout=timeout)
            elements = [element] if element else []
        for element in elements:
            try:
                size = element.rect.size
                if element.states.is_displayed and size[0] > 0 and size[1] > 0:
                    return element
            except Exception:
                continue
    return None


def _body_text(tab) -> str:
    body = tab.ele("tag:body", timeout=1)
    return str(body.text if body else "")


def _element_public_text(element) -> str:
    if not element:
        return ""
    text = str(getattr(element, "text", "") or "").strip()
    if text:
        return text
    for attribute in ("aria-label", "title", "alt"):
        try:
            value = str(element.attr(attribute) or "").strip()
        except (AttributeError, TypeError):
            value = ""
        if value:
            return value
    return ""


def _page_failure_code(tab) -> str | None:
    url = str(getattr(tab, "url", "") or "").strip().lower()
    try:
        title = str(getattr(tab, "title", "") or "").strip().lower()
    except Exception:
        title = ""
    body_head = _body_text(tab).strip().lower()[:1200]
    if url.startswith(("chrome-error://", "edge-error://")):
        return "browser_error_page"
    if re.search(r"(^|\D)404(\D|$)", title) or re.match(r"^\s*404(?:\s|$)", body_head):
        return "http_404_page"
    if any(marker in title or marker in body_head for marker in ERROR_PAGE_MARKERS):
        return "platform_error_page"
    return None


def _public_account_snapshot(platform: str, config: dict[str, Any], tab) -> tuple[str, str, str]:
    name_element = _first(tab, config.get("account_name") or [], timeout=2)
    link_element = _first(tab, config.get("account_link") or [], timeout=1)
    avatar_element = _first(tab, config.get("account_avatar") or [], timeout=1)
    display_name = _element_public_text(name_element)
    if display_name in {"-", "--", "加载中"}:
        display_name = ""
    profile_url = str(link_element.attr("href") or "").strip() if link_element else ""
    profile_url = urljoin(config["account_url"], profile_url) if profile_url else ""
    avatar_url = str(avatar_element.attr("src") or "").strip() if avatar_element else ""
    avatar_url = urljoin(config["account_url"], avatar_url) if avatar_url else ""
    if platform == "csdn" and not display_name and profile_url:
        parsed = urlparse(profile_url)
        public_slug = unquote(parsed.path.strip("/").split("/")[0])
        if parsed.hostname == "blog.csdn.net" and re.fullmatch(r"[A-Za-z0-9_.-]{1,160}", public_slug):
            display_name = public_slug
    if platform == "zhihu" and profile_url:
        parsed = urlparse(profile_url)
        path_parts = parsed.path.strip("/").split("/")
        public_slug = unquote(path_parts[1]) if len(path_parts) == 2 and path_parts[0] == "people" else ""
        if parsed.hostname in {"zhihu.com", "www.zhihu.com"} and re.fullmatch(r"[A-Za-z0-9_.-]{1,160}", public_slug):
            try:
                member = tab.run_js(
                    """async function(input) {
                      const response = await fetch('/api/v4/members/' + encodeURIComponent(input.slug), {
                        credentials: 'include'
                      });
                      if (!response.ok) return {};
                      const value = await response.json().catch(() => ({}));
                      return {
                        name: String(value.name || '').slice(0, 160),
                        avatarUrl: String(value.avatar_url || '').slice(0, 1000)
                      };
                    }""",
                    {"slug": public_slug},
                    timeout=10,
                )
            except Exception:
                member = {}
            if isinstance(member, dict):
                display_name = str(member.get("name") or display_name or "").strip()
                public_avatar = str(member.get("avatarUrl") or "").strip()
                if public_avatar.startswith("https://"):
                    avatar_url = public_avatar
            if not display_name:
                display_name = public_slug
    return display_name, profile_url, avatar_url


TOAST_SELECTORS = [
    "css:[role='alert']",
    "css:.ant-message-notice-content",
    "css:.el-message",
    "css:.byte-message",
    "css:.toast",
]


def _visible_publish_feedback(tab) -> str:
    messages: list[str] = []
    for selector in TOAST_SELECTORS:
        try:
            elements = tab.eles(selector, timeout=0.2)
        except (AttributeError, TypeError):
            element = tab.ele(selector, timeout=0.2)
            elements = [element] if element else []
        for element in elements:
            try:
                text = str(element.text or "").strip()
                if element.states.is_displayed and text and text not in messages:
                    messages.append(text)
            except Exception:
                continue
    return " | ".join(messages)[:240]


def _start_publish_response_capture(tab, config: dict[str, Any]) -> bool:
    targets = config.get("publish_response_targets") or []
    if not targets:
        return False
    try:
        tab.listen.start(targets)
        return True
    except Exception:
        return False


def _stop_publish_response_capture(tab) -> None:
    try:
        tab.listen.stop()
    except Exception:
        pass


def _nested_article_id(body: Any) -> str | None:
    if not isinstance(body, dict):
        return None
    for key in ("article_id", "articleId"):
        value = str(body.get(key) or "").strip()
        if value:
            return value
    for key in ("data", "article", "article_draft"):
        value = _nested_article_id(body.get(key))
        if value:
            return value
    return None


def _publish_response_evidence(packet, toast_text: str = "") -> dict[str, Any]:
    response = getattr(packet, "response", None) if packet else None
    status = int(getattr(response, "status", 0) or 0)
    body = getattr(response, "body", None)
    body = body if isinstance(body, dict) else {}
    code = body.get("err_no", body.get("error_code", body.get("code")))
    normalized_code = str(code).strip().lower() if code is not None else ""
    accepted_codes = {"", "0", "200", "ok", "success"}
    toast = str(toast_text or "").strip()
    normalized_toast = toast.lower()
    toast_rejected = any(marker in normalized_toast for marker in ("失败", "拒绝", "违规", "错误", "error", "failed", "denied"))
    toast_accepted = any(marker in normalized_toast for marker in ("发布成功", "已提交", "审核中", "success"))
    response_accepted = bool(response) and 200 <= status < 300 and normalized_code in accepted_codes
    rejected = bool(response) and not response_accepted
    return {
        "captured": bool(response) or bool(toast),
        "accepted": (response_accepted or toast_accepted) and not toast_rejected,
        "rejected": rejected or toast_rejected,
        "httpStatus": status or None,
        "businessCode": normalized_code or None,
        "articleId": _nested_article_id(body),
        "toast": toast,
    }


def _wait_publish_response_evidence(tab, capture_started: bool, timeout: int = 5) -> dict[str, Any]:
    packet = None
    try:
        if capture_started:
            packet = tab.listen.wait(timeout=timeout, raise_err=False)
        return _publish_response_evidence(packet, _visible_publish_feedback(tab))
    finally:
        if capture_started:
            _stop_publish_response_capture(tab)


def _publish_response_result(platform: str, evidence: dict[str, Any]) -> dict[str, Any] | None:
    if not evidence.get("captured"):
        return None
    toast = str(evidence.get("toast") or "")
    if has_security_challenge(toast):
        return _manual_takeover(f"{platform} 发布响应出现验证码或安全挑战。")
    if evidence.get("rejected"):
        status = evidence.get("httpStatus") or "unknown"
        code = evidence.get("businessCode") or "unknown"
        return _failure(
            "platform_rejected",
            f"{platform} 发布响应明确拒绝（HTTP {status}，业务码 {code}）。",
            "保留当前草稿和拒绝证据；仅在平台给出明确内容原因时生成一个新版本和新排程。",
        )
    if evidence.get("accepted"):
        article_id = str(evidence.get("articleId") or "").strip() or None
        result: dict[str, Any] = {
            "ok": True,
            "status": "published_pending_url",
            "publishStatus": "confirmed",
            "verifyStatus": "pending",
            "pendingCsvReturn": True,
            "nextAction": f"{platform} 发布响应已接受；继续只读核验创作后台与公开 URL。",
            "diagnosticSummary": "publish_response_accepted_pending_public_verification",
        }
        if article_id:
            result["platformArticleId"] = article_id
        return result
    return None


def _input(element, value: str) -> None:
    try:
        element.input(value, clear=True)
    except TypeError:
        element.clear()
        element.input(value)


def _input_first(tab, selectors: list[str], value: str, timeout: float = 5) -> bool:
    for attempt in range(2):
        element = _first(tab, selectors, timeout=timeout)
        if not element:
            return False
        try:
            _input(element, value)
            return True
        except Exception as error:
            if type(error).__name__ != "ElementLostError" or attempt == 1:
                raise
    return False


def _click_optional(tab, selectors: list[str], timeout: float = 1) -> bool:
    element = _first(tab, selectors, timeout=timeout)
    if not element:
        return False
    element.click()
    return True


def _xpath_literal(value: str) -> str:
    if "'" not in value:
        return f"'{value}'"
    if '"' not in value:
        return f'"{value}"'
    parts = value.split("'")
    return "concat(" + ", \"'\", ".join(f"'{part}'" for part in parts) + ")"


def _choice_selectors(value: str, selected: bool) -> list[str]:
    literal = _xpath_literal(value)
    state = (
        "(@aria-selected='true' or @aria-checked='true' or @data-selected='true' "
        "or contains(concat(' ',normalize-space(@class),' '),' selected ') "
        "or contains(concat(' ',normalize-space(@class),' '),' active ') "
        "or contains(concat(' ',normalize-space(@class),' '),' checked '))"
    )
    if selected:
        return [
            f"xpath://*[@data-id={literal} and {state}]",
            f"xpath://*[normalize-space(.)={literal} and {state}]",
        ]
    return [
        f"xpath://*[@data-id={literal}]",
        f"xpath://*[normalize-space(.)={literal}]",
    ]


def _render_choice_templates(templates: list[str], value: str) -> list[str]:
    literal = _xpath_literal(value)
    return [str(template).replace("{{value}}", literal) for template in templates]


def _element_is_selected(element) -> bool:
    for name in ("aria-selected", "aria-checked", "data-selected", "checked"):
        try:
            if str(element.attr(name) or "").lower() in {"true", "checked", "selected"}:
                return True
        except Exception:
            continue
    try:
        classes = set(str(element.attr("class") or "").lower().split())
    except Exception:
        classes = set()
    return bool(
        classes.intersection({"selected", "active", "checked", "is-selected", "is-active", "is-checked"})
        or any(item.endswith("--selected") or item.endswith("--checked") for item in classes)
    )


def _ensure_selected(
    tab,
    value: str,
    field_name: str,
    selected_templates: list[str] | None = None,
    option_templates: list[str] | None = None,
    *,
    click_by_js: bool = False,
) -> tuple[bool, str | None]:
    selected_selectors = _render_choice_templates(selected_templates or [], value) or _choice_selectors(value, selected=True)
    option_selectors = _render_choice_templates(option_templates or [], value) or _choice_selectors(value, selected=False)
    selected = _first_displayed(tab, selected_selectors, timeout=1)
    option = _first_displayed(tab, option_selectors, timeout=1)
    if selected or (option and _element_is_selected(option)):
        return True, None

    option = option or _first_displayed(tab, option_selectors, timeout=2)
    if not option:
        return False, f"未找到{field_name}选项：{value}。"
    option.click(by_js=click_by_js)
    tab.wait(0.3)
    selected = _first_displayed(tab, selected_selectors, timeout=1)
    refreshed = _first_displayed(tab, option_selectors, timeout=1)
    if selected or (refreshed and _element_is_selected(refreshed)):
        return True, None
    return False, f"{field_name}已尝试选择，但页面未显示明确选中态：{value}。"


def _failure(code: str, reason: str, next_action: str) -> dict[str, Any]:
    return {
        "ok": False,
        "status": "failed",
        "publishStatus": "failed",
        "failureCode": code,
        "failureReason": reason,
        "nextAction": next_action,
    }


def _unconfirmed(reason: str) -> dict[str, Any]:
    return {
        "ok": False,
        "status": "pending_verify",
        "publishStatus": "failed",
        "failureCode": "publish_action_unconfirmed",
        "failureReason": reason,
        "pendingCsvReturn": True,
        "nextAction": "只检查指定草稿和创作后台；确认平台没有文章记录前不要创建新草稿或重复点击发布。",
    }


def _editor_url(platform: str, payload: dict[str, Any], config: dict[str, Any]) -> str:
    if platform not in {"csdn", "juejin"}:
        return str(payload.get("editorUrl") or config["editor_url"])
    draft_id = str(payload.get("externalDraftId") or "").strip()
    editor_url = str(payload.get("editorUrl") or "").strip()
    if not draft_id or not editor_url:
        raise ValueError(f"{platform} hybrid publish requires externalDraftId and editorUrl")
    parsed = urlparse(editor_url)
    if parsed.scheme != "https" or parsed.hostname not in config["editor_hosts"]:
        raise ValueError(f"{platform} editorUrl is not an approved platform URL")
    if draft_id not in unquote(editor_url):
        raise ValueError(f"{platform} editorUrl does not contain externalDraftId")
    return editor_url


def _wait_for_publish_action(tab, confirm_selectors: list[str], initial_url: str, success_markers: list[str], timeout_seconds: int = 10) -> bool:
    for _ in range(max(1, timeout_seconds * 2)):
        if has_security_challenge(_body_text(tab)):
            return False
        if str(tab.url) != initial_url:
            return True
        if not _first(tab, confirm_selectors, timeout=0.2):
            return True
        text = _body_text(tab).lower()
        if any(marker.lower() in text for marker in success_markers):
            return True
        tab.wait(0.5)
    return False


def _article_id(value: str, pattern: str) -> str | None:
    match = re.search(pattern, value or "")
    return match.group(1) if match else None


def _record_status(text: str, config: dict[str, Any]) -> str | None:
    normalized = text.lower()
    if any(marker.lower() in normalized for marker in config["published_markers"]):
        return "published"
    if any(marker.lower() in normalized for marker in config["review_markers"]):
        return "pending_review"
    return None


def _public_url(value: str, pattern: str) -> str | None:
    match = re.search(pattern, value or "")
    return match.group(0) if match else None


def _known_public_url_from_identity(platform: str, payload: dict[str, Any]) -> str | None:
    config = _config(platform)
    public_url = _public_url(str(payload.get("publicUrl") or ""), config["public_pattern"])
    if public_url:
        return public_url
    article_id = str(payload.get("platformArticleId") or "").strip()
    if platform == "zhihu" and article_id.isdigit():
        return f"https://zhuanlan.zhihu.com/p/{article_id}"
    return None


def _verify_known_public_url(platform: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    config = _config(platform)
    public_url = _public_url(str(payload.get("publicUrl") or ""), config["public_pattern"])
    if not public_url:
        return None
    try:
        request = Request(
            public_url,
            headers={"User-Agent": os.environ.get("WECHATSYNC_USER_AGENT", "").strip() or "Mozilla/5.0"},
        )
        with urlopen(request, timeout=10) as response:
            status = int(getattr(response, "status", 0))
            final_url = _public_url(str(getattr(response, "url", "") or public_url), config["public_pattern"])
            if 200 <= status < 300 and final_url:
                article_id = _article_id(final_url, config["article_id_pattern"])
                return {
                    "ok": True,
                    "status": "published_verified",
                    "publishStatus": "confirmed",
                    "verifyStatus": "verified",
                    "platformArticleId": article_id or payload.get("platformArticleId"),
                    "publicUrl": final_url,
                    "pendingCsvReturn": False,
                    "nextAction": "已重新验证工作台回填的公开 URL。",
                    "diagnosticSummary": "known_public_url_reachable",
                }
    except HTTPError as error:
        if error.code in {404, 410}:
            return {
                "ok": False,
                "status": "removed_after_publish",
                "publishStatus": "failed",
                "verifyStatus": "failed",
                "platformArticleId": payload.get("platformArticleId"),
                "publicUrl": public_url,
                "pendingCsvReturn": False,
                "failureCode": "removed_after_publish",
                "failureReason": f"已回填公开 URL 返回 HTTP {error.code}。",
                "nextAction": "只继续执行存活复验；不要重新创建草稿或重复发布。",
                "diagnosticSummary": "known_public_url_removed",
            }
    except Exception:
        return None
    return None


def _manual_takeover(message: str) -> dict[str, Any]:
    return {
        "ok": False,
        "status": "manual_takeover_required",
        "publishStatus": "pending_review",
        "failureCode": "manual_takeover_required",
        "failureReason": message,
        "nextAction": "请在专用浏览器中完成人工验证，再先检查平台后台是否已生成文章；不要直接重复发布。",
    }


def _publish_juejin_page_context(tab, payload: dict[str, Any]) -> dict[str, Any]:
    result = tab.run_js(
        """async function(input) {
          const request = async (url, body) => {
            const response = await fetch(url, {
              method: 'POST',
              credentials: 'include',
              headers: {'content-type': 'application/json'},
              body: JSON.stringify(body)
            });
            const value = await response.json().catch(() => ({}));
            return {
              ok: response.ok,
              status: response.status,
              errNo: value.err_no ?? value.error_code ?? 0,
              message: String(value.err_msg || value.message || '').slice(0, 500),
              data: value && typeof value.data === 'object' ? value.data : {}
            };
          };
          const base = {aid: 2608, uuid: '0', spider: 0};
          const draft = await request('https://api.juejin.cn/content_api/v1/article_draft/create', {
            ...base,
            title: input.title,
            brief_content: String(input.summary || input.markdown).slice(0, 100),
            mark_content: input.markdown,
            category_id: input.categoryId,
            tag_ids: input.tagIds,
            edit_type: 10,
            html_content: 'deprecated'
          });
          const draftId = String(draft.data.id || draft.data.draft_id || draft.data.article_id || '');
          if (!draft.ok || String(draft.errNo) !== '0' || !draftId) {
            return {stage: 'draft', accepted: false, status: draft.status, errNo: draft.errNo, message: draft.message};
          }
          const published = await request('https://api.juejin.cn/content_api/v1/article/publish', {
            ...base,
            draft_id: draftId,
            sync_to_org: false
          });
          const articleId = String(published.data.article_id || published.data.id || '');
          return {
            stage: 'publish',
            accepted: published.ok && String(published.errNo) === '0' && Boolean(articleId),
            status: published.status,
            errNo: published.errNo,
            message: published.message,
            draftId,
            articleId
          };
        }""",
        {
            "title": str(payload.get("title") or ""),
            "summary": str(payload.get("summary") or ""),
            "markdown": str(payload.get("markdown") or ""),
            "categoryId": str(payload.get("categoryId") or ""),
            "tagIds": payload.get("tagIds") or [],
        },
        timeout=45,
    )
    if not isinstance(result, dict):
        return _unconfirmed("juejin 页面上下文发布没有返回结构化结果。")
    message = str(result.get("message") or "").strip()
    if has_security_challenge(message):
        return _manual_takeover("juejin 页面上下文接口返回安全挑战。")
    if not result.get("accepted"):
        return _failure(
            "adapter_failed",
            f"juejin {result.get('stage') or 'publish'} 接口拒绝：{message or result.get('errNo') or result.get('status')}。",
            "保留当前幂等记录，修正平台分类/标签或账号状态后只执行后台核验，不要盲目重复发布。",
        )
    article_id = str(result.get("articleId") or "").strip()
    draft_id = str(result.get("draftId") or "").strip()
    return {
        "ok": True,
        "status": "published_pending_url",
        "publishStatus": "confirmed",
        "verifyStatus": "pending",
        "platformArticleId": article_id,
        "externalDraftId": draft_id,
        "editorUrl": f"https://juejin.cn/editor/drafts/{draft_id}",
        "publicUrl": f"https://juejin.cn/post/{article_id}",
        "pendingCsvReturn": True,
        "nextAction": "页面上下文发布接口已返回文章 ID；继续验证公开 URL 和存活状态。",
        "diagnosticSummary": "page_context_publish_api_accepted_pending_liveness",
    }


def _verify_juejin_draft_api(payload: dict[str, Any]) -> dict[str, Any] | None:
    external_draft_id = str(payload.get("externalDraftId") or "").strip()
    cookie = os.environ.get("JUEJIN_COOKIE", "").strip()
    if not external_draft_id or not cookie:
        return None
    csrf_token = os.environ.get("JUEJIN_CSRF_TOKEN", "").strip()
    if not csrf_token:
        csrf_token = next(
            (
                item.split("=", 1)[1]
                for item in (part.strip() for part in cookie.split(";"))
                if item.startswith("passport_csrf_token=")
            ),
            "",
        )
    query = os.environ.get("JUEJIN_DRAFT_API_QUERY", "").strip() or (
        f"aid=2608&uuid={quote(os.environ.get('JUEJIN_UUID', ''))}&spider=0"
    )
    url = os.environ.get("JUEJIN_DRAFT_DETAIL_API_URL", "").strip() or (
        f"https://api.juejin.cn/content_api/v1/article_draft/detail?{query}"
    )
    request = Request(
        url,
        data=json.dumps({"draft_id": external_draft_id}).encode("utf-8"),
        method="POST",
        headers={
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json",
            "Cookie": cookie,
            "Origin": os.environ.get("JUEJIN_ORIGIN", "").strip() or "https://juejin.cn",
            "Referer": os.environ.get("JUEJIN_REFERER", "").strip() or "https://juejin.cn/editor/drafts/new",
            "User-Agent": os.environ.get("WECHATSYNC_USER_AGENT", "").strip() or "Mozilla/5.0",
            **({"x-secsdk-csrf-token": csrf_token} if csrf_token else {}),
        },
    )
    try:
        with urlopen(request, timeout=15) as response:
            body = json.loads(response.read().decode("utf-8"))
    except Exception:
        return None
    if int(body.get("err_no") or 0) != 0:
        return None
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    article_draft = data.get("article_draft") if isinstance(data.get("article_draft"), dict) else {}
    article_id = str(
        data.get("article_id")
        or data.get("articleId")
        or article_draft.get("article_id")
        or article_draft.get("articleId")
        or ""
    ).strip()
    if not article_id:
        return None
    public_url = f"https://juejin.cn/post/{article_id}"
    try:
        public_request = Request(
            public_url,
            headers={"User-Agent": os.environ.get("WECHATSYNC_USER_AGENT", "").strip() or "Mozilla/5.0"},
        )
        with urlopen(public_request, timeout=10) as response:
            public_reachable = 200 <= int(getattr(response, "status", 0)) < 300
    except Exception:
        public_reachable = False
    if public_reachable:
        return {
            "ok": True,
            "status": "published_verified",
            "publishStatus": "confirmed",
            "verifyStatus": "verified",
            "platformArticleId": article_id,
            "publicUrl": public_url,
            "pendingCsvReturn": False,
            "nextAction": "已从掘金 draft detail 的 article_draft.article_id 和公开 URL 确认文章。",
            "diagnosticSummary": "juejin_draft_api_confirmed_article",
        }
    return {
        "ok": True,
        "status": "published_pending_url",
        "publishStatus": "pending_review",
        "verifyStatus": "pending",
        "platformArticleId": article_id,
        "pendingCsvReturn": True,
        "nextAction": "掘金已生成 article_id，但公开 URL 尚不可访问；等待平台审核或公开后再验证。",
        "diagnosticSummary": "juejin_article_id_pending_public_url",
    }


class BrowserPublisher:
    def open_auth(self, platform: str, profile_ref: str | None = None) -> dict[str, Any]:
        """Open a dedicated, visible login window without reading or returning credentials."""
        config = _config(platform)
        key = _profile_key(platform, profile_ref)
        with _profile_lock(platform, profile_ref):
            browser = _browser(platform, profile_ref)
            existing = PLATFORM_AUTH_TABS.get(key)
            if existing is not None:
                try:
                    if existing.states.is_alive:
                        return {
                            "ok": True,
                            "status": "waiting_for_user",
                            "message": f"{platform} 专用登录窗口已经打开。",
                            "nextAction": "请在该窗口完成登录或安全验证，然后回到工作台重新检查。",
                        }
                except Exception:
                    PLATFORM_AUTH_TABS.pop(key, None)
            try:
                tab = browser.new_tab()
                tab.get(config["login_url"])
                PLATFORM_AUTH_TABS[key] = tab
                page_failure = _page_failure_code(tab)
                if page_failure:
                    return {
                        "ok": False,
                        "status": "failed",
                        "failureCode": "platform_login_page_unavailable",
                        "message": f"{platform} 官方登录页面当前不可用。",
                        "nextAction": "检查平台官方登录地址后重新发起账号连接；不要在错误页继续等待。",
                    }
                if has_security_challenge(_body_text(tab)):
                    return {
                        "ok": True,
                        "status": "manual_takeover_required",
                        "message": f"{platform} 登录窗口需要人工完成安全验证。",
                        "nextAction": "请在专用窗口完成验证码、手机确认或安全挑战；系统不会代替你处理。",
                    }
                return {
                    "ok": True,
                    "status": "waiting_for_user",
                    "message": f"{platform} 专用登录窗口已打开。",
                    "nextAction": "请完成登录后回到工作台；系统会自动识别并连接当前账号。",
                }
            except Exception as error:
                return {
                    "ok": False,
                    "status": "failed",
                    "message": f"{platform} 登录窗口启动失败：{type(error).__name__}。",
                    "nextAction": "检查专用浏览器是否可启动、profile 是否被占用，然后重试。",
                }

    def check_auth(self, platform: str, profile_ref: str | None = None) -> dict[str, Any]:
        config = _config(platform)
        with _profile_lock(platform, profile_ref):
            browser = _browser(platform, profile_ref)
            tab = browser.new_tab(background=True)
            try:
                tab.get(config["account_url"])
                url = str(tab.url)
                text = _body_text(tab)
                page_failure = _page_failure_code(tab)
                if page_failure:
                    return {
                        "authenticated": False,
                        "status": "failed",
                        "failureCode": "platform_account_page_unavailable",
                        "message": f"{platform} 账号检查页面当前不可用。",
                        "nextAction": "更新平台账号检查地址后重试；系统不会把错误页判定为已登录。",
                    }
                if has_security_challenge(text):
                    return {"authenticated": False, "status": "manual_takeover_required", "message": f"{platform} 出现安全挑战。", "nextAction": "请在专用浏览器 profile 中人工完成验证。"}
                on_login_page = any(marker.lower() in url.lower() for marker in config["login_markers"])
                account_name, _, _ = _public_account_snapshot(platform, config, tab)
                logged_in = not on_login_page and bool(account_name)
                return {
                    "authenticated": logged_in,
                    "status": "ready" if logged_in else "auth_required",
                    "message": f"{platform} 登录态可用。" if logged_in else f"{platform} 需要重新登录。",
                    "nextAction": "可以执行正式发布。" if logged_in else "请在专用浏览器 profile 中完成登录。",
                }
            except Exception as error:
                if has_security_challenge(_body_text(tab)):
                    return {"authenticated": False, "status": "manual_takeover_required", "message": f"{platform} 出现安全挑战。", "nextAction": "请在专用浏览器 profile 中人工完成验证。"}
                return {
                    "authenticated": False,
                    "status": "failed",
                    "message": f"{platform} 浏览器登录态检查失败：{type(error).__name__}。",
                    "failureCode": "adapter_failed",
                    "nextAction": "检查专用浏览器是否可启动、profile 是否被占用以及账号检查页结构；修复后只重跑预检查。",
                }
            finally:
                tab.close()

    def identify_account(self, platform: str, profile_ref: str | None = None) -> dict[str, Any]:
        """Return public account identity only; never return browser credentials or private identifiers."""
        config = _config(platform)
        with _profile_lock(platform, profile_ref):
            browser = _browser(platform, profile_ref)
            tab = browser.new_tab(background=True)
            try:
                tab.get(config["account_url"])
                url = str(tab.url)
                text = _body_text(tab)
                page_failure = _page_failure_code(tab)
                if page_failure:
                    return {
                        "identified": False,
                        "status": "failed",
                        "failureCode": "platform_account_page_unavailable",
                        "message": f"{platform} 账号检查页面当前不可用。",
                        "nextAction": "更新平台账号检查地址后重试；系统不会从错误页识别账号。",
                    }
                if has_security_challenge(text):
                    return {"identified": False, "status": "manual_takeover_required", "message": f"{platform} 出现安全挑战。"}
                if any(marker.lower() in url.lower() for marker in config["login_markers"]):
                    return {"identified": False, "status": "auth_required", "message": f"{platform} 尚未登录。"}
                display_name, profile_url, avatar_url = _public_account_snapshot(platform, config, tab)
                if not display_name:
                    return {
                        "identified": False,
                        "status": "account_identity_unavailable",
                        "message": f"{platform} 已登录，但未能从公开创作页面识别账号名称。",
                        "nextAction": "更新账号公开信息 selector 后重试；不得用通用 Profile 名称代替真实账号。",
                    }
                provider_ref = profile_url or f"{platform}:public-name:{display_name}"
                return {
                    "identified": True,
                    "status": "account_detected",
                    "account": {
                        "providerAccountRef": provider_ref[:191],
                        "publicDisplayName": display_name[:160],
                        "publicAvatarUrl": avatar_url[:1000] if avatar_url.startswith("https://") else None,
                        "publicProfileUrl": profile_url[:1000] if profile_url.startswith("https://") else None,
                        "capabilities": ["article_publish"],
                    },
                }
            finally:
                tab.close()

    def publish(self, platform: str, payload: dict[str, Any]) -> dict[str, Any]:
        config = _config(platform)
        profile_ref = str(payload.get("browserProfileRef") or "").strip() or None
        expected_fingerprint = str(payload.get("accountFingerprint") or "").strip().lower()
        if expected_fingerprint:
            identity = self.identify_account(platform, profile_ref)
            if not identity.get("identified"):
                return _failure(
                    "auth_required",
                    str(identity.get("message") or f"{platform} 发布前无法识别账号。"),
                    "恢复已确认账号的登录态后创建新排程；系统不会向未知账号发布。",
                )
            account = identity.get("account") if isinstance(identity.get("account"), dict) else {}
            provider_ref = str(account.get("providerAccountRef") or "").strip()
            actual_fingerprint = hashlib.sha256(f"{platform}:{provider_ref}".encode("utf-8")).hexdigest()
            if actual_fingerprint != expected_fingerprint:
                return {
                    "ok": False,
                    "status": "risk_blocked",
                    "publishStatus": "failed",
                    "failureCode": "risk_blocked",
                    "failureReason": f"{platform} 当前登录账号与工作台确认账号不一致。",
                    "nextAction": "重新连接并确认当前真实账号；禁止继续或自动切换目标账号。",
                }
        with _profile_lock(platform, profile_ref):
            browser = _browser(platform, profile_ref)
            tab = browser.new_tab()
            publish_action_started = False
            response_capture_started = False
            try:
                if platform == "juejin" and not payload.get("externalDraftId"):
                    tab.get(config["editor_url"])
                    if any(marker.lower() in str(tab.url).lower() for marker in config["login_markers"]):
                        return {"ok": False, "status": "precheck_failed", "publishStatus": "failed", "failureCode": "auth_required", "failureReason": "juejin 登录态已失效。", "nextAction": "保持任务阻断，恢复专用 profile 登录态后创建新排程。"}
                    if has_security_challenge(_body_text(tab)):
                        return _manual_takeover("juejin 编辑器出现验证码或安全挑战。")
                    return _publish_juejin_page_context(tab, payload)
                try:
                    editor_url = _editor_url(platform, payload, config)
                except ValueError as error:
                    return _failure("payload_invalid", str(error), "重新从平台草稿 API 创建排程载荷，禁止打开新建稿页面代替指定草稿。")
                tab.get(editor_url)
                if any(marker.lower() in str(tab.url).lower() for marker in config["login_markers"]):
                    return {"ok": False, "status": "precheck_failed", "publishStatus": "failed", "failureCode": "auth_required", "failureReason": f"{platform} 登录态已失效。", "nextAction": "请在专用浏览器 profile 中重新登录后创建新的发布排程。"}
                if has_security_challenge(_body_text(tab)):
                    return _manual_takeover(f"{platform} 在编辑器阶段出现验证码或安全挑战。")

                if not _input_first(tab, config["title"], str(payload["title"])):
                    return {"ok": False, "status": "failed", "publishStatus": "failed", "failureCode": "adapter_failed", "failureReason": f"{platform} 编辑器结构已变化，未找到标题或正文输入区。", "diagnosticCode": "editor structure changed before title or content input", "nextAction": "请人工检查页面并更新本机 selector 配置；不要重复发布。"}
                if not _input_first(tab, config["content"], str(payload["markdown"])):
                    return {"ok": False, "status": "failed", "publishStatus": "failed", "failureCode": "adapter_failed", "failureReason": f"{platform} 编辑器结构已变化，未找到标题或正文输入区。", "diagnosticCode": "editor structure changed before title or content input", "nextAction": "请人工检查页面并更新本机 selector 配置；不要重复发布。"}

                if platform in {"csdn", "juejin"}:
                    if not _click_optional(tab, config["publish"], timeout=5):
                        return {"ok": False, "status": "failed", "publishStatus": "failed", "failureCode": "adapter_failed", "failureReason": f"{platform} 未找到发布设置入口。", "nextAction": "请人工检查编辑器页面，确认未发布后更新 selector。"}
                    publish_action_started = True
                    tab.wait(1)
                    if has_security_challenge(_body_text(tab)):
                        return _manual_takeover(f"{platform} 在发布设置阶段出现验证码或安全挑战。")
                if platform in {"csdn", "juejin"}:
                    category = (
                        os.environ.get("JUEJIN_CATEGORY_LABEL", "").strip() or str(payload.get("categoryId") or "").strip()
                        if platform == "juejin"
                        else str(payload.get("categoryId") or "").strip()
                    )
                    if category:
                        selected, reason = _ensure_selected(tab, category, "分类", config["category_selected"], config["category_option"])
                        if not selected:
                            return _failure("payload_invalid", reason or f"{platform} 分类未选中。", f"更新{platform}分类 selector 或分类配置，确认明确选中态后再发布。")
                if platform in {"csdn", "juejin"}:
                    tags = payload.get("tagIds") or []
                    if platform == "juejin":
                        tags = [item.strip() for item in os.environ.get("JUEJIN_TAG_LABELS", "").split(",") if item.strip()]
                    for tag in tags:
                        selected, _ = _ensure_selected(
                            tab,
                            str(tag),
                            "标签",
                            config["tag_selected"],
                            config["tag_option"],
                            click_by_js=platform == "juejin",
                        )
                        if not selected:
                            tag_input = _first(tab, config["tag_input"], timeout=1)
                            if tag_input:
                                _input(tag_input, str(tag))
                                tab.wait(0.2)
                            selected, reason = _ensure_selected(
                                tab,
                                str(tag),
                                "标签",
                                config["tag_selected"],
                                config["tag_option"],
                                click_by_js=platform == "juejin",
                            )
                        else:
                            reason = None
                        if not selected:
                            return _failure("payload_invalid", reason or f"标签未选中：{tag}。", "更新标签 selector 或标签配置，确认每个标签均显示明确选中态后再发布。")

                if platform not in {"csdn", "juejin"}:
                    response_capture_started = _start_publish_response_capture(tab, config)
                    if not _click_optional(tab, config["publish"], timeout=5):
                        _stop_publish_response_capture(tab)
                        response_capture_started = False
                        return {"ok": False, "status": "failed", "publishStatus": "failed", "failureCode": "adapter_failed", "failureReason": f"{platform} 未找到正式发布按钮。", "nextAction": "请人工检查编辑器页面，确认未发布后更新 selector。"}
                    publish_action_started = True
                    tab.wait(1)
                    if has_security_challenge(_body_text(tab)):
                        return _manual_takeover(f"{platform} 在发布确认阶段出现验证码或安全挑战。")
                confirm = _first(tab, config["confirm"], timeout=5)
                if not confirm:
                    response_evidence = _wait_publish_response_evidence(tab, response_capture_started)
                    response_capture_started = False
                    response_result = _publish_response_result(platform, response_evidence)
                    if response_result and not response_result.get("ok"):
                        return response_result
                    if platform == "zhihu":
                        direct_publish_result = self._verify_tab(platform, tab, payload)
                        if direct_publish_result.get("ok"):
                            return direct_publish_result
                    if response_result:
                        return response_result
                    return _unconfirmed(f"{platform} 第一层发布已点击，但最终确认弹窗或确认按钮未出现。")
                before_confirm_url = str(tab.url)
                if not response_capture_started:
                    response_capture_started = _start_publish_response_capture(tab, config)
                confirm.click()
                response_evidence = _wait_publish_response_evidence(tab, response_capture_started, timeout=10)
                response_capture_started = False
                response_result = _publish_response_result(platform, response_evidence)
                if response_result and not response_result.get("ok"):
                    return response_result
                if not _wait_for_publish_action(tab, config["confirm"], before_confirm_url, config["success_markers"]):
                    if has_security_challenge(_body_text(tab)):
                        return _manual_takeover(f"{platform} 在最终确认后出现验证码或安全挑战。")
                    if response_result:
                        return response_result
                    return _unconfirmed(f"{platform} 最终确认按钮已点击，但弹窗未关闭、页面未跳转且没有成功提示。")
                verified_result = self._verify_tab(platform, tab, payload)
                if verified_result.get("ok"):
                    return verified_result
                return response_result or verified_result
            except Exception as error:
                if has_security_challenge(_body_text(tab)):
                    return _manual_takeover(f"{platform} 出现验证码或安全挑战。")
                if publish_action_started:
                    return _unconfirmed(f"{platform} 发布点击后浏览器执行异常：{type(error).__name__}。")
                return {"ok": False, "status": "failed", "publishStatus": "failed", "failureCode": "adapter_failed", "failureReason": f"{platform} 浏览器执行失败：{type(error).__name__}", "nextAction": "请先检查平台后台是否已生成文章；确认未生成后再创建新排程。"}
            finally:
                if response_capture_started:
                    _stop_publish_response_capture(tab)
                tab.close()

    def verify(self, platform: str, payload: dict[str, Any]) -> dict[str, Any]:
        profile_ref = str(payload.get("browserProfileRef") or "").strip() or None
        key = _profile_key(platform, profile_ref)
        with _profile_lock(platform, profile_ref):
            public_result = _verify_known_public_url(platform, payload)
            if public_result:
                return public_result
            if platform == "juejin":
                api_result = _verify_juejin_draft_api(payload)
                if api_result:
                    return api_result
            for attempt in range(2):
                tab = None
                try:
                    browser = _browser(platform, profile_ref)
                    tab = browser.new_tab()
                    return self._verify_tab(platform, tab, payload)
                except Exception as error:
                    if not is_transient_browser_error(error) or attempt == 1:
                        raise
                    PLATFORM_BROWSERS.pop(key, None)
                finally:
                    if tab is not None:
                        try:
                            tab.close()
                        except Exception:
                            pass
            raise RuntimeError(f"{platform} verification retry exhausted")

    def _verify_tab(self, platform: str, tab, payload: dict[str, Any]) -> dict[str, Any]:
        config = _config(platform)
        if platform == "juejin":
            api_result = _verify_juejin_draft_api(payload)
            if api_result:
                return api_result
        known_public_url = _known_public_url_from_identity(platform, payload)
        if platform == "zhihu" and known_public_url:
            try:
                tab.get(known_public_url)
                text = _body_text(tab)
                url = _public_url(str(tab.url), config["public_pattern"])
                missing_markers = ["页面不存在", "内容不存在", "文章不存在", "该内容已删除", "page not found"]
                login_redirected = any(marker.lower() in str(tab.url).lower() for marker in config["login_markers"])
                if (
                    url
                    and not login_redirected
                    and not has_security_challenge(text)
                    and not any(marker.lower() in text.lower() for marker in missing_markers)
                ):
                    article_id = _article_id(url, config["article_id_pattern"])
                    return {
                        "ok": True,
                        "status": "published_verified",
                        "publishStatus": "confirmed",
                        "verifyStatus": "verified",
                        "platformArticleId": article_id or payload.get("platformArticleId"),
                        "publicUrl": url,
                        "pendingCsvReturn": False,
                        "nextAction": "已优先通过知乎文章 ID 或公开 URL 验证公开页面。",
                        "diagnosticSummary": "known_article_identity_public_page",
                    }
            except Exception:
                pass
        url = _public_url(str(tab.url), config["public_pattern"])
        article_id = _article_id(url or "", config["article_id_pattern"])
        if not url:
            tab.get(config["manager_url"])
            text = _body_text(tab)
            if has_security_challenge(text):
                return _manual_takeover(f"{platform} 在发布后验证阶段出现安全挑战。")
            if any(marker.lower() in str(tab.url).lower() for marker in config["login_markers"]):
                return _failure("auth_required", f"{platform} 在发布后验证阶段登录态失效。", "请在专用浏览器 profile 中重新登录，然后只执行后台验证。")
            title = str(payload.get("title") or "").strip()
            literal = _xpath_literal(title)
            title_element = _first(tab, [f"xpath://a[normalize-space(.)={literal}]", f"xpath://*[normalize-space(.)={literal}]"], timeout=5) if title else None
            if not title_element:
                return _unconfirmed(f"{platform} 创作后台未找到同标题文章：{title}。")
            try:
                record = title_element.ele(
                    "xpath:./ancestor-or-self::*[self::tr or @role='row' or self::li or self::article "
                    "or contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'creationmanage-creationcard') "
                    "or contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'article-list-item-mp') "
                    "or contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'article-item')][1]",
                    timeout=1,
                )
            except Exception:
                record = None
            record = record or title_element
            record_text = str(getattr(record, "text", "") or "")
            anchor = None
            if platform == "csdn":
                try:
                    anchor = record.ele("xpath:.//a[contains(@href,'blog.csdn.net') and contains(@href,'/article/details/')]", timeout=1)
                except Exception:
                    anchor = None
            anchor = anchor or (title_element if str(getattr(title_element, "tag", "")).lower() == "a" else None)
            if not anchor:
                try:
                    anchor = title_element.ele("xpath:./ancestor-or-self::a[@href][1]", timeout=1)
                except Exception:
                    anchor = None
            try:
                raw_href = str(anchor.attr("href") or "") if anchor else ""
            except Exception:
                raw_href = ""
            if not raw_href:
                try:
                    anchor = record.ele("xpath:.//a[@href]", timeout=1)
                    raw_href = str(anchor.attr("href") or "") if anchor else ""
                except Exception:
                    raw_href = ""
            href = urljoin(config["manager_url"], raw_href) if raw_href else ""
            url = _public_url(href, config["public_pattern"])
            article_id = _article_id(href, config["article_id_pattern"])
            review_record_id = article_id or str(payload.get("externalDraftId") or "").strip() or None
            record_status = _record_status(record_text, config)
            if url and article_id:
                return {"ok": True, "status": "published_verified", "publishStatus": "confirmed", "platformArticleId": article_id, "externalTaskId": None, "publicUrl": url, "pendingCsvReturn": False, "nextAction": "已从同标题创作后台记录确认公开文章 ID。", "diagnosticSummary": "creator_record_public_article"}
            if record_status == "pending_review" and review_record_id:
                return {"ok": True, "status": "published_pending_url", "publishStatus": "pending_review", "externalTaskId": review_record_id, "pendingCsvReturn": True, "nextAction": "已在同标题后台记录中确认审核中状态；不要重复发布。", "diagnosticSummary": "creator_record_pending_review"}
            if record_status == "published" and review_record_id:
                return {"ok": True, "status": "published_verified" if url else "published_pending_url", "publishStatus": "confirmed", "platformArticleId": article_id, "externalTaskId": None if article_id else review_record_id, "publicUrl": url, "pendingCsvReturn": not bool(url), "nextAction": "已在同标题后台记录中确认已发布状态。", "diagnosticSummary": "creator_record_published"}
            if not record_status:
                return _unconfirmed(f"{platform} 后台找到了同标题记录，但未读取到已发布或审核中状态。")
            return _unconfirmed(f"{platform} 后台找到了同标题状态，但没有文章 ID 或审核记录 ID。")
        if url:
            article_id = article_id or url.rstrip("/").split("/")[-1]
            return {"ok": True, "status": "published_verified", "publishStatus": "confirmed", "platformArticleId": article_id, "publicUrl": url, "pendingCsvReturn": False, "nextAction": "平台公开页面已验证。"}
        return _unconfirmed(f"{platform} 未找到可公开页面或同标题后台记录。")
