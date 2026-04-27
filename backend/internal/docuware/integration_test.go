package docuware

import (
	"strings"
	"testing"
)

func TestUrlTokenEncode(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		// "User=APAdmin\nPwd=AYOH.123!" → standard base64 has no = padding,
		// so the suffix must be "0" and no '+' or '/' to swap.
		{
			name: "no padding, no swap",
			in:   "User=APAdmin\\nPwd=AYOH.123!",
			want: "VXNlcj1BUEFkbWluXG5Qd2Q9QVlPSC4xMjMh0",
		},
		// 1 byte → base64 "AQ==", trailing == → strip both, suffix "2".
		{
			name: "two trailing pad",
			in:   "\x01",
			want: "AQ2",
		},
		// 2 bytes → base64 "AQI=", strip one =, suffix "1".
		{
			name: "one trailing pad",
			in:   "\x01\x02",
			want: "AQI1",
		},
		// Exercise '+' and '/' substitution. 0xfb 0xff 0xbf encodes as "+/+/" worth
		// of base64 — pick bytes producing both. 0xfb 0xff → "+/8="; the test below
		// checks the swap behaviour.
		{
			name: "swap chars",
			in:   "\xfb\xff",
			want: "-_81",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := urlTokenEncode([]byte(tc.in)); got != tc.want {
				t.Errorf("urlTokenEncode(%q) = %q; want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestConvertToURLTokenFormat(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"abcd", "abcd0"},
		{"abc=", "abc1"},
		{"ab==", "ab2"},
		{"a+b/c==", "a-b_c2"},
	}
	for _, tc := range cases {
		if got := convertToURLTokenFormat(tc.in); got != tc.want {
			t.Errorf("convertToURLTokenFormat(%q) = %q; want %q", tc.in, got, tc.want)
		}
	}
}

func TestBuildIntegrationURL_NotConfigured(t *testing.T) {
	if _, err := BuildIntegrationURL(IntegrationConfig{}, ModeViewer, `[DWDOCID]="x"`); err == nil {
		t.Fatal("expected error for unconfigured integration, got nil")
	}
}

func TestBuildIntegrationURL_RoundTrip(t *testing.T) {
	cfg := IntegrationConfig{
		ServerURL:        "https://transgalv.docuware.cloud",
		PassphraseBase64: "cG89PlZwSVFnV3o/K0MqZg==", // base64("po=>VpIQgWz?+C*f")
		Username:         "APAdmin",
		Password:         "AYOH.123!",
		CabinetID:        "3035e14f-37e6-4403-9de2-ed049d26d642",
		ResultDialogID:   "0e8d599f-e745-44dd-bc92-207f8522fe39",
	}
	url, err := BuildIntegrationURL(cfg, ModeViewer, `[DWDOCID] = "abc123"`)
	if err != nil {
		t.Fatalf("BuildIntegrationURL: %v", err)
	}
	if !strings.HasPrefix(url, "https://transgalv.docuware.cloud/DocuWare/Platform/WebClient/1/Integration?ep=") {
		t.Errorf("unexpected URL prefix: %s", url)
	}
	// AES output is deterministic for a fixed key/IV/plaintext. Re-running must
	// produce the same URL — guards against accidental nondeterminism.
	url2, _ := BuildIntegrationURL(cfg, ModeViewer, `[DWDOCID] = "abc123"`)
	if url != url2 {
		t.Errorf("non-deterministic URL builder: %q vs %q", url, url2)
	}
}
