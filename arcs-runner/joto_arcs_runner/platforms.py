import json
import os
import re
import threading
from pathlib import Path
from typing import Any


PLATFORM_CONFIG: dict[str, dict[str, Any]] = {
    "csdn": {
        "auth_url": "https://mp.csdn.net/mp_blog/manage/article",
        "editor_url": "https://editor.csdn.net/md/?not_checkout=1",
        "manager_url": "https://mp.csdn.net/mp_blog/manage/article",
        "login_markers": ["passport.csdn.net", "login"],
        "title": ["xpath://input[contains(@placeholder,'文章标题')]", "css:input.title-input"],
        "content": ["css:.CodeMirror textarea", "xpath://div[contains(@class,'CodeMirror')]//textarea"],
        "publish": ["xpath://button[contains(normalize-space(.),'发布文章')]", "xpath://button[contains(normalize-space(.),'发布')]"],
        "confirm": ["xpath://button[contains(normalize-space(.),'确认发布')]", "xpath://button[contains(normalize-space(.),'发布文章')]"],
        "public_pattern": r"https://blog\.csdn\.net/[^/]+/article/details/\d+",
    },
    "juejin": {
        "auth_url": "https://juejin.cn/creator/content/article",
        "editor_url": "https://juejin.cn/editor/drafts/new?v=2",
        "manager_url": "https://juejin.cn/creator/content/article",
        "login_markers": ["login", "passport"],
        "title": ["xpath://input[contains(@placeholder,'输入文章标题')]", "css:input.title-input"],
        "content": ["css:.bytemd-editor textarea", "css:.CodeMirror textarea", "xpath://textarea"],
        "publish": ["xpath://button[contains(normalize-space(.),'发布')]"],
        "confirm": ["xpath://button[contains(normalize-space(.),'确定并发布')]", "xpath://button[contains(normalize-space(.),'确认发布')]"],
        "public_pattern": r"https://juejin\.cn/post/[A-Za-z0-9]+",
    },
    "zhihu": {
        "auth_url": "https://www.zhihu.com/creator",
        "editor_url": "https://zhuanlan.zhihu.com/write",
        "manager_url": "https://www.zhihu.com/creator/manage/creation/article",
        "login_markers": ["/signin", "login"],
        "title": ["xpath://textarea[contains(@placeholder,'请输入标题')]", "css:textarea.WriteIndex-titleInput"],
        "content": ["css:.DraftEditor-root", "xpath://div[contains(@class,'DraftEditor-root')]"],
        "publish": ["xpath://button[contains(normalize-space(.),'发布')]"],
        "confirm": ["xpath://button[contains(normalize-space(.),'确认发布')]"],
        "public_pattern": r"https://zhuanlan\.zhihu\.com/p/\d+",
    },
}

CHALLENGE_MARKERS = ["验证码", "安全验证", "手机号验证", "手机确认", "captcha", "security challenge", "滑块"]
REVIEW_MARKERS = ["审核中", "等待审核", "平台审核", "pending review"]
PLATFORM_LOCKS = {platform: threading.Lock() for platform in PLATFORM_CONFIG}


def has_security_challenge(text: str) -> bool:
    normalized = text.lower()
    return any(marker.lower() in normalized for marker in CHALLENGE_MARKERS)


def _profile_root() -> Path:
    configured = os.environ.get("JOTO_PUBLISH_PROFILE_ROOT", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    local_data = os.environ.get("LOCALAPPDATA", "").strip()
    if local_data:
        return (Path(local_data) / "JotoPublishProfiles").resolve()
    return (Path.home() / ".joto-publish-profiles").resolve()


def profile_dir(platform: str) -> Path:
    env_name = f"{platform.upper()}_BROWSER_PROFILE_DIR"
    configured = os.environ.get(env_name, "").strip()
    path = Path(configured).expanduser().resolve() if configured else (_profile_root() / platform).resolve()
    repository_root = Path(__file__).resolve().parents[2]
    if path == repository_root or repository_root in path.parents:
        raise ValueError(f"{env_name} must be outside the repository")
    path.mkdir(parents=True, exist_ok=True)
    return path


def _config(platform: str) -> dict[str, Any]:
    config = dict(PLATFORM_CONFIG[platform])
    raw = os.environ.get(f"ARCS_{platform.upper()}_SELECTORS_JSON", "").strip()
    if raw:
        value = json.loads(raw)
        if isinstance(value, dict):
            config.update(value)
    return config


def _browser(platform: str):
    try:
        from DrissionPage import Chromium, ChromiumOptions
    except ImportError as error:
        raise RuntimeError("DrissionPage is not installed; run `uv sync` in arcs-runner") from error

    options = ChromiumOptions()
    options.set_local_port(9330 + list(PLATFORM_CONFIG).index(platform))
    options.set_user_data_path(str(profile_dir(platform)))
    options.set_argument("--start-maximized")
    options.headless(False)
    return Chromium(addr_or_opts=options)


def _first(tab, selectors: list[str], timeout: float = 2):
    for selector in selectors:
        element = tab.ele(selector, timeout=timeout)
        if element:
            return element
    return None


def _body_text(tab) -> str:
    body = tab.ele("tag:body", timeout=1)
    return str(body.text if body else "")


def _input(element, value: str) -> None:
    try:
        element.input(value, clear=True)
    except TypeError:
        element.clear()
        element.input(value)


def _click_optional(tab, selectors: list[str], timeout: float = 1) -> bool:
    element = _first(tab, selectors, timeout=timeout)
    if not element:
        return False
    element.click()
    return True


def _public_url(value: str, pattern: str) -> str | None:
    match = re.search(pattern, value or "")
    return match.group(0) if match else None


def _manual_takeover(message: str) -> dict[str, Any]:
    return {
        "ok": False,
        "status": "manual_takeover_required",
        "publishStatus": "pending_review",
        "failureCode": "manual_takeover_required",
        "failureReason": message,
        "nextAction": "请在专用浏览器中完成人工验证，再先检查平台后台是否已生成文章；不要直接重复发布。",
    }


class BrowserPublisher:
    def check_auth(self, platform: str) -> dict[str, Any]:
        config = _config(platform)
        with PLATFORM_LOCKS[platform]:
            browser = _browser(platform)
            tab = browser.new_tab()
            try:
                tab.get(config["auth_url"])
                url = str(tab.url)
                text = _body_text(tab)
                if has_security_challenge(text):
                    return {"authenticated": False, "status": "manual_takeover_required", "message": f"{platform} 出现安全挑战。", "nextAction": "请在专用浏览器 profile 中人工完成验证。"}
                logged_in = not any(marker.lower() in url.lower() for marker in config["login_markers"])
                return {
                    "authenticated": logged_in,
                    "status": "ready" if logged_in else "auth_required",
                    "message": f"{platform} 登录态可用。" if logged_in else f"{platform} 需要重新登录。",
                    "nextAction": "可以执行正式发布。" if logged_in else "请在专用浏览器 profile 中完成登录。",
                }
            finally:
                tab.close()
                browser.quit()

    def publish(self, platform: str, payload: dict[str, Any]) -> dict[str, Any]:
        config = _config(platform)
        with PLATFORM_LOCKS[platform]:
            browser = _browser(platform)
            tab = browser.new_tab()
            try:
                tab.get(config["editor_url"])
                if any(marker.lower() in str(tab.url).lower() for marker in config["login_markers"]):
                    return {"ok": False, "status": "precheck_failed", "publishStatus": "failed", "failureCode": "auth_required", "failureReason": f"{platform} 登录态已失效。", "nextAction": "请在专用浏览器 profile 中重新登录后创建新的发布排程。"}
                if has_security_challenge(_body_text(tab)):
                    return _manual_takeover(f"{platform} 在编辑器阶段出现验证码或安全挑战。")

                title = _first(tab, config["title"], timeout=5)
                content = _first(tab, config["content"], timeout=5)
                if not title or not content:
                    return {"ok": False, "status": "failed", "publishStatus": "failed", "failureCode": "adapter_failed", "failureReason": f"{platform} 编辑器结构已变化，未找到标题或正文输入区。", "nextAction": "请人工检查页面并更新本机 selector 配置；不要重复发布。"}
                _input(title, str(payload["title"]))
                _input(content, str(payload["markdown"]))

                if platform == "juejin":
                    category = os.environ.get("JUEJIN_CATEGORY_LABEL", "").strip() or str(payload.get("categoryId") or "").strip()
                    if category:
                        _click_optional(tab, [f"xpath://*[@data-id='{category}']", f"xpath://*[contains(normalize-space(.),'{category}')]"], timeout=1)
                if platform == "csdn":
                    category = str(payload.get("categoryId") or "").strip()
                    if category:
                        _click_optional(tab, [f"xpath://*[contains(normalize-space(.),'{category}')]"], timeout=1)
                if platform in {"csdn", "juejin"}:
                    tags = payload.get("tagIds") or []
                    tag_input = _first(tab, ["xpath://input[contains(@placeholder,'标签')]", "xpath://input[contains(@placeholder,'搜索')]"], timeout=1)
                    if tag_input:
                        for tag in tags:
                            _input(tag_input, str(tag))
                            tab.wait(0.2)
                            _click_optional(tab, [f"xpath://*[contains(normalize-space(.),'{tag}')]"], timeout=1)

                if not _click_optional(tab, config["publish"], timeout=5):
                    return {"ok": False, "status": "failed", "publishStatus": "failed", "failureCode": "adapter_failed", "failureReason": f"{platform} 未找到正式发布按钮。", "nextAction": "请人工检查编辑器页面，确认未发布后更新 selector。"}
                tab.wait(1)
                if has_security_challenge(_body_text(tab)):
                    return _manual_takeover(f"{platform} 在发布确认阶段出现验证码或安全挑战。")
                _click_optional(tab, config["confirm"], timeout=3)
                tab.wait(2)
                return self._verify_tab(platform, tab, payload)
            except Exception as error:
                if has_security_challenge(_body_text(tab)):
                    return _manual_takeover(f"{platform} 出现验证码或安全挑战。")
                return {"ok": False, "status": "failed", "publishStatus": "failed", "failureCode": "adapter_failed", "failureReason": f"{platform} 浏览器执行失败：{type(error).__name__}", "nextAction": "请先检查平台后台是否已生成文章；确认未生成后再创建新排程。"}
            finally:
                tab.close()
                browser.quit()

    def verify(self, platform: str, payload: dict[str, Any]) -> dict[str, Any]:
        with PLATFORM_LOCKS[platform]:
            browser = _browser(platform)
            tab = browser.new_tab()
            try:
                return self._verify_tab(platform, tab, payload)
            finally:
                tab.close()
                browser.quit()

    def _verify_tab(self, platform: str, tab, payload: dict[str, Any]) -> dict[str, Any]:
        config = _config(platform)
        url = _public_url(str(tab.url), config["public_pattern"])
        if not url:
            tab.get(config["manager_url"])
            text = _body_text(tab)
            if has_security_challenge(text):
                return _manual_takeover(f"{platform} 在发布后验证阶段出现安全挑战。")
            title = str(payload.get("title") or "").strip()
            anchor = _first(tab, [f"xpath://a[contains(normalize-space(.),'{title}')]"], timeout=5) if title else None
            href = str(anchor.attr("href")) if anchor else ""
            url = _public_url(href, config["public_pattern"])
            if not url and any(marker.lower() in text.lower() for marker in REVIEW_MARKERS):
                return {"ok": True, "status": "pending_verify", "publishStatus": "pending_review", "pendingCsvReturn": True, "nextAction": "平台文章仍在审核；后续只执行验证，不要重复发布。"}
        if url:
            article_id = url.rstrip("/").split("/")[-1]
            return {"ok": True, "status": "published_verified", "publishStatus": "confirmed", "platformArticleId": article_id, "publicUrl": url, "pendingCsvReturn": False, "nextAction": "平台公开页面已验证。"}
        return {"ok": True, "status": "pending_verify", "publishStatus": "submitted", "pendingCsvReturn": True, "nextAction": "未找到可公开访问的文章链接；后续只执行验证，不要重复发布。"}
