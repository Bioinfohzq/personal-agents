package server

import (
	"encoding/json"
	"net/http"
)

// jsonEncode 将 payload 编码为 JSON 写入 w（net/http 版本辅助）
func jsonEncode(w http.ResponseWriter, payload any) error {
	return json.NewEncoder(w).Encode(payload)
}
