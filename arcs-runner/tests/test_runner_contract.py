import hashlib
import os
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.error import HTTPError


RUNNER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNNER_ROOT))

from joto_arcs_runner.ledger import PublishLedger
from joto_arcs_runner.platforms import (
    PLATFORM_CONFIG,
    BrowserPublisher,
    _editor_url,
    _element_is_selected,
    _input_first,
    _publish_response_evidence,
    _publish_response_result,
    _record_status,
    _publish_juejin_page_context,
    _verify_juejin_draft_api,
    _verify_known_public_url,
    has_security_challenge,
    is_transient_browser_error,
    profile_dir,
)
from joto_arcs_runner.server import RunnerService, expected_idempotency_key, validate_publish_payload


class FakePublisher:
    def __init__(self):
        self.publish_calls = 0
        self.verify_payload = None

    def check_auth(self, platform):
        return {"authenticated": True, "status": "ready"}

    def open_auth(self, platform):
        return {"ok": True, "status": "waiting_for_user", "message": f"{platform} login opened"}

    def publish(self, platform, payload):
        self.publish_calls += 1
        return {"ok": True, "status": "published_verified", "publishStatus": "confirmed", "publicUrl": "https://example.com/public"}

    def verify(self, platform, payload):
        self.verify_payload = payload
        return {"ok": True, "status": "published_verified", "publishStatus": "confirmed", "publicUrl": "https://example.com/public"}


class ResumePublisher(FakePublisher):
    def publish(self, platform, value):
        self.publish_calls += 1
        return {"ok": True, "status": "published_verified", "publishStatus": "confirmed", "publicUrl": "https://example.com/resumed"}


class ThrowingPublisher(FakePublisher):
    def publish(self, platform, value):
        self.publish_calls += 1
        raise RuntimeError("browser startup failed")


def payload():
    value = {
        "scheduleId": "schedule-1",
        "platform": "csdn",
        "contentHash": "a" * 64,
        "title": "Test title",
        "markdown": "Test markdown body",
        "externalDraftId": "123456",
        "editorUrl": "https://editor.csdn.net/md?articleId=123456",
        "categoryId": "人工智能",
        "tagIds": ["AI"],
    }
    value["idempotencyKey"] = hashlib.sha256(f"{value['scheduleId']}:{value['platform']}:{value['contentHash']}".encode("utf-8")).hexdigest()
    return value


class RunnerContractTest(unittest.TestCase):
    def test_platform_login_and_account_urls_are_separated(self):
        expected = {
            "csdn": (
                "https://passport.csdn.net/login",
                "https://mp.csdn.net/mp_blog/manage/article",
            ),
            "juejin": (
                "https://juejin.cn/login",
                "https://juejin.cn/creator/home",
            ),
            "zhihu": (
                "https://www.zhihu.com/signin",
                "https://www.zhihu.com/creator",
            ),
        }
        for platform, (login_url, account_url) in expected.items():
            with self.subTest(platform=platform):
                self.assertEqual(PLATFORM_CONFIG[platform]["login_url"], login_url)
                self.assertEqual(PLATFORM_CONFIG[platform]["account_url"], account_url)
                self.assertNotEqual(login_url, account_url)
        self.assertEqual(
            PLATFORM_CONFIG["juejin"]["manager_url"],
            "https://juejin.cn/creator/content/article/essays?status=all",
        )

    def test_open_auth_uses_each_platform_official_login_url(self):
        class Element:
            text = ""

        class Tab:
            title = ""

            def __init__(self):
                self.url = ""
                self.opened_url = ""

            def get(self, url):
                self.url = url
                self.opened_url = url

            def ele(self, selector, timeout=1):
                return Element() if selector == "tag:body" else None

        class Browser:
            def __init__(self, tab):
                self.tab = tab

            def new_tab(self, **_kwargs):
                return self.tab

        from unittest.mock import patch

        for platform in PLATFORM_CONFIG:
            with self.subTest(platform=platform):
                tab = Tab()
                profile_ref = f"login-route-{platform}"
                with patch("joto_arcs_runner.platforms._browser", return_value=Browser(tab)):
                    result = BrowserPublisher().open_auth(platform, profile_ref)
                self.assertEqual(result["status"], "waiting_for_user")
                self.assertEqual(tab.opened_url, PLATFORM_CONFIG[platform]["login_url"])

    def test_auth_check_rejects_a_404_account_page(self):
        class Element:
            text = "404 page not found"

        class Tab:
            title = "404 - Not Found"

            def __init__(self):
                self.url = ""
                self.opened_url = ""

            def get(self, url):
                self.url = url
                self.opened_url = url

            def ele(self, selector, timeout=1):
                return Element() if selector == "tag:body" else None

            def close(self):
                return None

        class Browser:
            def __init__(self, tab):
                self.tab = tab

            def new_tab(self, **_kwargs):
                return self.tab

        from unittest.mock import patch

        tab = Tab()
        with patch("joto_arcs_runner.platforms._browser", return_value=Browser(tab)):
            result = BrowserPublisher().check_auth("juejin", "account-route-juejin")
        self.assertEqual(tab.opened_url, PLATFORM_CONFIG["juejin"]["account_url"])
        self.assertFalse(result["authenticated"])
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["failureCode"], "platform_account_page_unavailable")

    def test_csdn_identification_uses_public_profile_slug_when_nickname_is_delayed(self):
        class Element:
            def __init__(self, text="", attributes=None):
                self.text = text
                self.attributes = attributes or {}

            def attr(self, name):
                return self.attributes.get(name, "")

        class Tab:
            title = "内容管理-CSDN创作中心"

            def __init__(self):
                self.url = ""
                self.background = False

            def get(self, url):
                self.url = url

            def ele(self, selector, timeout=1):
                if selector == "tag:body":
                    return Element("内容管理 退出")
                if "blog.csdn.net" in selector:
                    return Element(attributes={"href": "https://blog.csdn.net/Kari11"})
                return None

            def close(self):
                return None

        class Browser:
            def __init__(self, tab):
                self.tab = tab

            def new_tab(self, *, background=False):
                self.tab.background = background
                return self.tab

        from unittest.mock import patch

        tab = Tab()
        with patch("joto_arcs_runner.platforms._browser", return_value=Browser(tab)):
            result = BrowserPublisher().identify_account("csdn", "csdn-public-profile")
        self.assertTrue(tab.background)
        self.assertTrue(result["identified"])
        self.assertEqual(result["account"]["publicDisplayName"], "Kari11")
        self.assertEqual(result["account"]["publicProfileUrl"], "https://blog.csdn.net/Kari11")

    def test_zhihu_identification_uses_header_profile_and_public_member_name(self):
        class Element:
            def __init__(self, text="", attributes=None):
                self.text = text
                self.attributes = attributes or {}

            def attr(self, name):
                return self.attributes.get(name, "")

        class Tab:
            title = "创作中心 - 知乎"

            def __init__(self):
                self.url = ""
                self.background = False
                self.member_slug = ""

            def get(self, url):
                self.url = url

            def ele(self, selector, timeout=1):
                if selector == "tag:body":
                    return Element("创作中心")
                if selector == "css:a.AppHeader-profileAvatar[href*='/people/']":
                    return Element(attributes={"href": "https://www.zhihu.com/people/xhwwwww"})
                if selector == "css:a.AppHeader-profileAvatar img":
                    return Element(attributes={"src": "https://pic1.zhimg.com/header.jpg"})
                return None

            def run_js(self, _script, args, timeout=None):
                self.member_slug = args["slug"]
                return {"name": "洸予", "avatarUrl": "https://pic1.zhimg.com/public.jpg"}

            def close(self):
                return None

        class Browser:
            def __init__(self, tab):
                self.tab = tab

            def new_tab(self, *, background=False):
                self.tab.background = background
                return self.tab

        from unittest.mock import patch

        tab = Tab()
        with patch("joto_arcs_runner.platforms._browser", return_value=Browser(tab)):
            result = BrowserPublisher().identify_account("zhihu", "zhihu-header-profile")
        self.assertTrue(tab.background)
        self.assertEqual(tab.member_slug, "xhwwwww")
        self.assertTrue(result["identified"])
        self.assertEqual(result["account"]["publicDisplayName"], "洸予")
        self.assertEqual(result["account"]["publicProfileUrl"], "https://www.zhihu.com/people/xhwwwww")
        self.assertEqual(result["account"]["publicAvatarUrl"], "https://pic1.zhimg.com/public.jpg")

    def test_open_auth_only_opens_a_dedicated_login_window(self):
        with tempfile.TemporaryDirectory() as directory:
            publisher = FakePublisher()
            service = RunnerService(PublishLedger(Path(directory) / "ledger.json"), publisher)
            status, result = service.open_auth({"platform": "zhihu"})
            self.assertEqual(status, 200)
            self.assertEqual(result["status"], "waiting_for_user")
            self.assertNotIn("cookie", str(result).lower())
            self.assertNotIn("token", str(result).lower())

    def test_dynamic_editor_input_refetches_one_lost_element(self):
        class ElementLostError(Exception):
            pass

        class Element:
            def __init__(self, lost=False):
                self.lost = lost

            def input(self, _value, clear=True):
                if self.lost:
                    raise ElementLostError("rerendered")

        class Tab:
            calls = 0

            def ele(self, _selector, timeout=2):
                self.calls += 1
                return Element(lost=self.calls == 1)

        tab = Tab()
        self.assertTrue(_input_first(tab, ["css:input"], "value"))
        self.assertEqual(tab.calls, 2)

    def test_zhihu_publish_selector_does_not_match_publish_settings(self):
        selector = PLATFORM_CONFIG["zhihu"]["publish"][0]
        self.assertIn("normalize-space(.)='发布'", selector)
        self.assertNotIn("contains", selector)

    def test_idempotency_contract(self):
        value = payload()
        self.assertEqual(expected_idempotency_key(value), value["idempotencyKey"])
        self.assertIsNone(validate_publish_payload(value))
        value["contentHash"] = "b" * 64
        self.assertIn("idempotencyKey", validate_publish_payload(value))

    def test_duplicate_never_publishes_twice(self):
        with tempfile.TemporaryDirectory() as directory:
            publisher = FakePublisher()
            service = RunnerService(PublishLedger(Path(directory) / "ledger.json"), publisher)
            first_status, first = service.publish(payload())
            second_status, second = service.publish(payload())
            self.assertEqual(first_status, 200)
            self.assertEqual(second_status, 200)
            self.assertTrue(first["ok"])
            self.assertTrue(second["duplicateProtected"])
            self.assertEqual(publisher.publish_calls, 1)

    def test_in_progress_duplicate_is_unconfirmed_and_never_submitted(self):
        with tempfile.TemporaryDirectory() as directory:
            value = payload()
            ledger = PublishLedger(Path(directory) / "ledger.json")
            ledger.begin(value["idempotencyKey"], {"platform": value["platform"], "title": value["title"]})
            service = RunnerService(ledger, FakePublisher())
            status, result = service.publish(value)
            self.assertEqual(status, 409)
            self.assertEqual(result["failureCode"], "publish_action_unconfirmed")
            self.assertNotEqual(result.get("publishStatus"), "submitted")

    def test_publisher_exception_is_completed_in_ledger_instead_of_left_in_progress(self):
        with tempfile.TemporaryDirectory() as directory:
            value = payload()
            ledger = PublishLedger(Path(directory) / "ledger.json")
            status, result = RunnerService(ledger, ThrowingPublisher()).publish(value)
            self.assertEqual(status, 502)
            self.assertEqual(result["failureCode"], "adapter_failed")
            stored = ledger.get(value["idempotencyKey"])
            self.assertEqual(stored["status"], "failed")
            self.assertEqual(stored["result"]["failureCode"], "adapter_failed")

    def test_payload_failure_can_resume_the_same_platform_draft(self):
        with tempfile.TemporaryDirectory() as directory:
            value = payload()
            ledger = PublishLedger(Path(directory) / "ledger.json")
            ledger.begin(value["idempotencyKey"], {
                "platform": value["platform"],
                "title": value["title"],
                "externalDraftId": value["externalDraftId"],
                "editorUrl": value["editorUrl"],
            })
            ledger.complete(value["idempotencyKey"], {
                "ok": False,
                "status": "failed",
                "publishStatus": "failed",
                "failureCode": "payload_invalid",
            })
            publisher = ResumePublisher()
            status, result = RunnerService(ledger, publisher).publish(value)
            self.assertEqual(status, 200)
            self.assertTrue(result["ok"])
            self.assertEqual(publisher.publish_calls, 1)

    def test_editor_structure_failure_can_resume_the_same_platform_draft(self):
        with tempfile.TemporaryDirectory() as directory:
            value = payload()
            ledger = PublishLedger(Path(directory) / "ledger.json")
            ledger.begin(value["idempotencyKey"], {
                "platform": value["platform"],
                "title": value["title"],
                "externalDraftId": value["externalDraftId"],
                "editorUrl": value["editorUrl"],
            })
            ledger.complete(value["idempotencyKey"], {
                "ok": False,
                "status": "failed",
                "publishStatus": "failed",
                "failureCode": "adapter_failed",
                "failureReason": "csdn 编辑器结构已变化，未找到标题或正文输入区。",
            })
            publisher = ResumePublisher()
            status, result = RunnerService(ledger, publisher).publish(value)
            self.assertEqual(status, 200)
            self.assertTrue(result["ok"])
            self.assertEqual(publisher.publish_calls, 1)

    def test_juejin_page_context_browser_connect_failure_can_resume_before_any_draft_exists(self):
        with tempfile.TemporaryDirectory() as directory:
            value = payload()
            value["platform"] = "juejin"
            value.pop("externalDraftId")
            value.pop("editorUrl")
            value["idempotencyKey"] = expected_idempotency_key(value)
            ledger = PublishLedger(Path(directory) / "ledger.json")
            ledger.begin(value["idempotencyKey"], {
                "platform": "juejin",
                "title": value["title"],
            })
            ledger.complete(value["idempotencyKey"], {
                "ok": False,
                "status": "failed",
                "failureCode": "adapter_failed",
                "failureReason": "BrowserConnectError",
            })
            publisher = ResumePublisher()
            status, result = RunnerService(ledger, publisher).publish(value)
            self.assertEqual(status, 200)
            self.assertTrue(result["ok"])
            self.assertEqual(publisher.publish_calls, 1)

    def test_csdn_missing_final_button_can_resume_the_same_settings_draft(self):
        with tempfile.TemporaryDirectory() as directory:
            value = payload()
            ledger = PublishLedger(Path(directory) / "ledger.json")
            ledger.begin(value["idempotencyKey"], {
                "platform": value["platform"],
                "title": value["title"],
                "externalDraftId": value["externalDraftId"],
                "editorUrl": value["editorUrl"],
            })
            ledger.complete(value["idempotencyKey"], {
                "ok": False,
                "status": "pending_verify",
                "publishStatus": "failed",
                "failureCode": "publish_action_unconfirmed",
                "failureReason": "csdn 第一层发布已点击，但最终确认弹窗或确认按钮未出现。",
            })
            publisher = ResumePublisher()
            status, result = RunnerService(ledger, publisher).publish(value)
            self.assertEqual(status, 200)
            self.assertTrue(result["ok"])
            self.assertEqual(publisher.publish_calls, 1)

    def test_csdn_current_editor_content_selector_is_supported(self):
        self.assertIn("css:pre.editor__inner[contenteditable='true']", PLATFORM_CONFIG["csdn"]["content"])
        self.assertTrue(any(" el-tag " in selector for selector in PLATFORM_CONFIG["csdn"]["tag_selected"]))
        self.assertTrue(any(" btn-b-red " in selector for selector in PLATFORM_CONFIG["csdn"]["confirm"]))

    def test_csdn_opens_publish_settings_before_validating_tags(self):
        source = (RUNNER_ROOT / "joto_arcs_runner" / "platforms.py").read_text(encoding="utf-8")
        settings_open = source.index('if platform in {"csdn", "juejin"}:', source.index("def publish("))
        tag_validation = source.index('if platform in {"csdn", "juejin"}:', settings_open + 1)
        final_confirmation = source.index('confirm = _first(tab, config["confirm"]')
        self.assertLess(settings_open, tag_validation)
        self.assertLess(tag_validation, final_confirmation)

    def test_hybrid_payload_requires_the_platform_draft(self):
        value = payload()
        value.pop("externalDraftId")
        self.assertIn("externalDraftId", validate_publish_payload(value))

    def test_csdn_category_is_optional_but_tags_are_required(self):
        value = payload()
        value.pop("categoryId")
        self.assertIsNone(validate_publish_payload(value))
        value.pop("tagIds")
        self.assertIn("tagIds", validate_publish_payload(value))

    def test_juejin_category_remains_required(self):
        value = payload()
        value["platform"] = "juejin"
        value["editorUrl"] = "https://juejin.cn/editor/drafts/123456"
        value.pop("categoryId")
        value["idempotencyKey"] = expected_idempotency_key(value)
        self.assertIn("categoryId", validate_publish_payload(value))

    def test_juejin_page_context_publish_does_not_require_cookie_replay_or_hybrid_draft(self):
        value = payload()
        value["platform"] = "juejin"
        value.pop("externalDraftId")
        value.pop("editorUrl")
        value["idempotencyKey"] = expected_idempotency_key(value)
        self.assertIsNone(validate_publish_payload(value))

        class Tab:
            def run_js(self, _script, args, timeout=None):
                self.args = args
                self.timeout = timeout
                return {"accepted": True, "stage": "publish", "draftId": "draft-2", "articleId": "article-2"}

        tab = Tab()
        result = _publish_juejin_page_context(tab, value)
        self.assertEqual(result["status"], "published_pending_url")
        self.assertEqual(result["platformArticleId"], "article-2")
        self.assertEqual(tab.args["markdown"], value["markdown"])

    def test_juejin_tag_selectors_are_scoped_away_from_category_choices(self):
        config = PLATFORM_CONFIG["juejin"]
        self.assertIn("css:.tag-input.select input.byte-select__input", config["tag_input"])
        self.assertTrue(any("byte-select-option" in selector for selector in config["tag_option"]))
        self.assertTrue(any("添加标签" in selector and "byte-select__tag" in selector for selector in config["tag_selected"]))

    def test_juejin_opens_publish_settings_before_category_and_tag_selection(self):
        source = (RUNNER_ROOT / "joto_arcs_runner" / "platforms.py").read_text(encoding="utf-8")
        publish_settings = source.index('if platform in {"csdn", "juejin"}:', source.index("def publish("))
        category_selection = source.index('category = (', publish_settings)
        tag_selection = source.index('tags = payload.get("tagIds")', category_selection)
        final_confirmation = source.index('confirm = _first(tab, config["confirm"]', tag_selection)
        self.assertLess(publish_settings, category_selection)
        self.assertLess(category_selection, tag_selection)
        self.assertLess(tag_selection, final_confirmation)

    def test_all_platforms_capture_publish_response_without_logging_credentials(self):
        source = (RUNNER_ROOT / "joto_arcs_runner" / "platforms.py").read_text(encoding="utf-8")
        for platform in ("csdn", "juejin", "zhihu"):
            self.assertTrue(PLATFORM_CONFIG[platform]["publish_response_targets"])
        self.assertIn("_start_publish_response_capture(tab, config)", source)
        self.assertIn("_visible_publish_feedback(tab)", source)
        self.assertIn('"status": "published_pending_url"', source)
        self.assertIn('"diagnosticSummary": "publish_response_accepted_pending_public_verification"', source)
        self.assertNotIn("packet.request.headers", source)

    def test_publish_response_evidence_distinguishes_acceptance_and_rejection(self):
        class Response:
            status = 200
            body = {"err_no": 0, "data": {"article_id": "article-2"}}

        class Packet:
            response = Response()

        accepted = _publish_response_evidence(Packet(), "发布成功")
        self.assertTrue(accepted["accepted"])
        self.assertFalse(accepted["rejected"])
        self.assertEqual(accepted["articleId"], "article-2")
        accepted_result = _publish_response_result("juejin", accepted)
        self.assertEqual(accepted_result["status"], "published_pending_url")
        self.assertEqual(accepted_result["platformArticleId"], "article-2")

        class RejectedResponse:
            status = 200
            body = {"err_no": 1001, "err_msg": "private response details"}

        class RejectedPacket:
            response = RejectedResponse()

        rejected = _publish_response_evidence(RejectedPacket())
        rejected_result = _publish_response_result("juejin", rejected)
        self.assertTrue(rejected["rejected"])
        self.assertEqual(rejected_result["failureCode"], "platform_rejected")
        self.assertNotIn("private response details", rejected_result["failureReason"])

    def test_publish_toast_security_challenge_is_risk_blocked(self):
        evidence = _publish_response_evidence(None, "请完成手机号验证")
        result = _publish_response_result("zhihu", evidence)
        self.assertEqual(result["failureCode"], "manual_takeover_required")

    def test_publish_action_guard_is_initialized_inside_publish_method(self):
        source = (RUNNER_ROOT / "joto_arcs_runner" / "platforms.py").read_text(encoding="utf-8")
        publish_source = source[source.index("    def publish(self, platform:"):source.index("    def verify(self, platform:")]
        self.assertIn("publish_action_started = False", publish_source)

    def test_juejin_draft_api_reads_nested_article_id(self):
        class DetailResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def read(self):
                return b'{"err_no":0,"data":{"article_draft":{"article_id":"7668120258260074548"}}}'

        class PublicResponse:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

        from unittest.mock import patch
        with patch.dict(os.environ, {"JUEJIN_COOKIE": "passport_csrf_token=test"}, clear=False):
            with patch("joto_arcs_runner.platforms.urlopen", side_effect=[DetailResponse(), PublicResponse()]):
                result = _verify_juejin_draft_api({"externalDraftId": "draft-1"})
        self.assertEqual(result["status"], "published_verified")
        self.assertEqual(result["platformArticleId"], "7668120258260074548")

    def test_juejin_article_id_stays_pending_until_public_url_is_reachable(self):
        class DetailResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def read(self):
                return b'{"err_no":0,"data":{"article_draft":{"article_id":"7668120258260074548"}}}'

        from unittest.mock import patch
        with patch.dict(os.environ, {"JUEJIN_COOKIE": "passport_csrf_token=test"}, clear=False):
            with patch("joto_arcs_runner.platforms.urlopen", side_effect=[DetailResponse(), RuntimeError("not public")]):
                result = _verify_juejin_draft_api({"externalDraftId": "draft-1"})
        self.assertEqual(result["status"], "published_pending_url")
        self.assertEqual(result["publishStatus"], "pending_review")
        self.assertNotIn("publicUrl", result)

    def test_known_public_url_404_returns_structured_removed_evidence(self):
        from unittest.mock import patch

        error = HTTPError(
            "https://juejin.cn/post/7668120258260074548",
            404,
            "Not Found",
            hdrs=None,
            fp=None,
        )
        with patch("joto_arcs_runner.platforms.urlopen", side_effect=error):
            result = _verify_known_public_url(
                "juejin",
                {
                    "platformArticleId": "7668120258260074548",
                    "publicUrl": "https://juejin.cn/post/7668120258260074548",
                },
            )
        self.assertEqual(result["status"], "removed_after_publish")
        self.assertEqual(result["failureCode"], "removed_after_publish")
        self.assertEqual(result["publicUrl"], "https://juejin.cn/post/7668120258260074548")

    def test_zhihu_article_id_is_verified_before_title_fallback(self):
        class Body:
            text = "Known Zhihu article content"

        class Tab:
            url = ""

            def get(self, url):
                self.url = url

            def ele(self, selector, timeout=1):
                if selector == "tag:body":
                    return Body()
                raise AssertionError("title fallback must not run when the article ID resolves")

        result = BrowserPublisher()._verify_tab(
            "zhihu",
            Tab(),
            {"platformArticleId": "987654321", "title": "Title fallback should not be used"},
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["platformArticleId"], "987654321")
        self.assertEqual(result["publicUrl"], "https://zhuanlan.zhihu.com/p/987654321")
        self.assertEqual(result["diagnosticSummary"], "known_article_identity_public_page")

    def test_editor_url_must_open_the_same_approved_draft(self):
        value = payload()
        self.assertEqual(_editor_url("csdn", value, PLATFORM_CONFIG["csdn"]), value["editorUrl"])
        value["editorUrl"] = "https://example.com/md?articleId=123456"
        with self.assertRaises(ValueError):
            _editor_url("csdn", value, PLATFORM_CONFIG["csdn"])

    def test_verify_reuses_draft_identity_from_ledger(self):
        with tempfile.TemporaryDirectory() as directory:
            publisher = FakePublisher()
            service = RunnerService(PublishLedger(Path(directory) / "ledger.json"), publisher)
            value = payload()
            service.publish(value)
            service.verify({"idempotencyKey": value["idempotencyKey"]})
            self.assertEqual(publisher.verify_payload["externalDraftId"], value["externalDraftId"])

    def test_selected_state_and_record_status_are_explicit(self):
        class Element:
            def __init__(self, values):
                self.values = values

            def attr(self, name):
                return self.values.get(name)

        self.assertTrue(_element_is_selected(Element({"aria-selected": "true"})))
        self.assertFalse(_element_is_selected(Element({"class": "tag option"})))
        self.assertEqual(_record_status("Test title 审核中", PLATFORM_CONFIG["csdn"]), "pending_review")
        self.assertIsNone(_record_status("Test title 草稿", PLATFORM_CONFIG["csdn"]))

    def test_page_level_review_text_without_matching_title_is_unconfirmed(self):
        class Body:
            text = "其他文章 审核中"

        class Tab:
            url = "https://mp.csdn.net/mp_blog/manage/article"

            def get(self, url):
                self.url = url

            def ele(self, selector, timeout=1):
                return Body() if selector == "tag:body" else None

        result = BrowserPublisher()._verify_tab("csdn", Tab(), payload())
        self.assertFalse(result["ok"])
        self.assertEqual(result["failureCode"], "publish_action_unconfirmed")
        self.assertNotEqual(result.get("publishStatus"), "submitted")

    def test_matching_review_record_requires_and_returns_a_record_id(self):
        class Body:
            text = "Test title 审核中"

        class Record:
            text = "Test title 审核中"

            def ele(self, selector, timeout=1):
                return None

        class Title:
            tag = "a"
            text = "Test title"

            def ele(self, selector, timeout=1):
                return Record()

            def attr(self, name):
                return ""

        class Tab:
            url = "https://mp.csdn.net/mp_blog/manage/article"

            def get(self, url):
                self.url = url

            def ele(self, selector, timeout=1):
                if selector == "tag:body":
                    return Body()
                if "normalize-space" in selector:
                    return Title()
                return None

        result = BrowserPublisher()._verify_tab("csdn", Tab(), payload())
        self.assertTrue(result["ok"])
        self.assertEqual(result["publishStatus"], "pending_review")
        self.assertEqual(result["externalTaskId"], payload()["externalDraftId"])
        self.assertNotIn("platformArticleId", result)

    def test_matching_zhihu_title_uses_ancestor_public_link_as_publish_evidence(self):
        class Body:
            text = "文章管理 草稿"

        class Record:
            text = "Test title"

            def ele(self, selector, timeout=1):
                return None

        class Anchor:
            def attr(self, name):
                return "https://zhuanlan.zhihu.com/p/987654321"

        class Title:
            tag = "div"
            text = "Test title"

            def ele(self, selector, timeout=1):
                if "creationmanage-creationcard" in selector:
                    return Record()
                if "ancestor-or-self::a" in selector:
                    return Anchor()
                return None

        class Tab:
            url = "https://www.zhihu.com/creator/manage/creation/article"

            def get(self, url):
                self.url = url

            def ele(self, selector, timeout=1):
                if selector == "tag:body":
                    return Body()
                if "normalize-space" in selector:
                    return Title()
                return None

        result = BrowserPublisher()._verify_tab("zhihu", Tab(), payload())
        self.assertTrue(result["ok"])
        self.assertEqual(result["publishStatus"], "confirmed")
        self.assertEqual(result["platformArticleId"], "987654321")
        self.assertEqual(result["diagnosticSummary"], "creator_record_public_article")

    def test_matching_csdn_title_uses_current_record_public_link_as_publish_evidence(self):
        class Body:
            text = "文章管理"

        class Anchor:
            def attr(self, name):
                return "https://blog.csdn.net/example/article/details/163328639"

        class Record:
            text = "Test title 原创 2026-07-30"

            def ele(self, selector, timeout=1):
                if "blog.csdn.net" in selector:
                    return Anchor()
                return None

        class Title:
            tag = "a"
            text = "Test title"

            def ele(self, selector, timeout=1):
                if "article-list-item-mp" in selector:
                    return Record()
                return None

            def attr(self, name):
                return "https://editor.csdn.net/md/?articleId=123456"

        class Tab:
            url = "https://mp.csdn.net/mp_blog/manage/article"

            def get(self, url):
                self.url = url

            def ele(self, selector, timeout=1):
                if selector == "tag:body":
                    return Body()
                if "normalize-space" in selector:
                    return Title()
                return None

        result = BrowserPublisher()._verify_tab("csdn", Tab(), payload())
        self.assertTrue(result["ok"])
        self.assertEqual(result["publishStatus"], "confirmed")
        self.assertEqual(result["platformArticleId"], "163328639")
        self.assertEqual(result["diagnosticSummary"], "creator_record_public_article")

    def test_final_confirmation_is_not_optional(self):
        source = (RUNNER_ROOT / "joto_arcs_runner" / "platforms.py").read_text(encoding="utf-8")
        self.assertNotIn('_click_optional(tab, config["confirm"]', source)
        self.assertIn('confirm = _first(tab, config["confirm"]', source)
        self.assertIn('if platform == "zhihu":\n                        direct_publish_result = self._verify_tab', source)

    def test_security_challenge_detection(self):
        self.assertTrue(has_security_challenge("请完成手机号验证"))
        self.assertTrue(has_security_challenge("CAPTCHA required"))
        self.assertFalse(has_security_challenge("文章已发布"))

    def test_only_known_browser_disconnects_are_transient(self):
        PageDisconnectedError = type("PageDisconnectedError", (Exception,), {})
        self.assertTrue(is_transient_browser_error(PageDisconnectedError("disconnected")))
        self.assertFalse(is_transient_browser_error(RuntimeError("platform rejected")))

    def test_verify_rebuilds_browser_once_after_page_disconnect(self):
        class PageDisconnectedError(Exception):
            pass

        class FailingBrowser:
            def new_tab(self):
                raise PageDisconnectedError("disconnected")

        class WorkingTab:
            def close(self):
                return None

        class WorkingBrowser:
            def new_tab(self):
                return WorkingTab()

        from unittest.mock import patch
        publisher = BrowserPublisher()
        with patch("joto_arcs_runner.platforms._verify_known_public_url", return_value=None), patch(
            "joto_arcs_runner.platforms._verify_juejin_draft_api", return_value=None
        ), patch("joto_arcs_runner.platforms._browser", side_effect=[FailingBrowser(), WorkingBrowser()]), patch.object(
            publisher, "_verify_tab", return_value={"ok": False, "status": "pending_verify"}
        ):
            result = publisher.verify("juejin", {})
        self.assertEqual(result["status"], "pending_verify")

    def test_auth_check_reports_browser_failure_type(self):
        class FailingTab:
            url = ""

            def get(self, _url):
                raise RuntimeError("private details must not be returned")

            def ele(self, _selector, timeout=1):
                return None

            def close(self):
                return None

        class Browser:
            def new_tab(self, **_kwargs):
                return FailingTab()

            def quit(self):
                return None

        from unittest.mock import patch
        with patch("joto_arcs_runner.platforms._browser", return_value=Browser()):
            result = BrowserPublisher().check_auth("zhihu")
        self.assertEqual(result["status"], "failed")
        self.assertIn("RuntimeError", result["message"])
        self.assertNotIn("private details", result["message"])

    def test_profiles_are_outside_repository(self):
        with tempfile.TemporaryDirectory() as directory:
            previous = os.environ.get("LOCALAPPDATA")
            os.environ["LOCALAPPDATA"] = directory
            try:
                path = profile_dir("zhihu")
                self.assertTrue(str(path).startswith(str(Path(directory).resolve())))
            finally:
                if previous is None:
                    os.environ.pop("LOCALAPPDATA", None)
                else:
                    os.environ["LOCALAPPDATA"] = previous


if __name__ == "__main__":
    unittest.main()
