# Đóng Đợt B — local verification với B-A1-AV01 P2 còn mở

Ngày22/10/2026. Phạm vi đóng đợt do người dùng yêu cầu: chỉ docs/test, không triển khai A2-1/A2-2, không sửa src/scripts/package/tooling baseline, không commit/push/merge/deploy và không vào Đợt C. Cwd `C:\Users\84862\Desktop\totmart\TotMartAPI`; HEAD `56788dffccc4f0164d89160173705864e0023b24`, tag `round-b-checkpoint-2`. Bảy file docs có thay đổi từ lượt owner acceptance được giữ nguyên trước khi bổ sung nội dung đóng đợt.

Evidence riêng: `artifacts/round-b/close/04f4cb65-09a3-40d8-9b35-3d5861f690ca/`. Mọi attempt có UUID riêng, command.json và exit code riêng; latest pointers không trỏ vào evidence lịch sử. Các báo cáo A/auth/A1/A2-0 và image gốc giữ nguyên. Trạng thái đóng đợt chỉ có hiệu lực khi verifier sinh `round-b-seal.json` với `PASS_WITH_ACCEPTED_OPEN_P2` và kiểm tra lại bằng `--check` exit0. Không phải production-ready hoặc quyền mở staging thật/mở bán.

Kết luận lượt đóng: **Đợt B đóng với B-A1-AV01 P2 còn mở được owner chấp nhận**, theo phạm vi local của seal và các điều kiện hết hạn trong nguyên văn quyết định. Verifier preflight exit0; gate và exit cuối đều đạt. Cleanup kiểm độc lập **86 resource ID absent**, port Mongo identity fixtures đóng; bốn container ID/name và mọi image tag/ID đầu vào còn hiện diện. Source ngoài docs/test, baseline và protected evidence lịch sử giữ hash. Seal/check do verifier thực hiện; không sửa tay JSON seal. Không commit và chưa vào Đợt C; dừng chờ “tiếp”.

## Quyết định owner và hợp đồng FE

[BE-open-issues](BE-open-issues.md) có khối **“Văn bản do owner cung cấp — nguyên văn”**, chép đúng phản hồi người dùng, kể cả `<Q>`, `<22/10/2026>` và các placeholder giảm nhẹ. File `owner-provided.txt` lưu cùng văn bản; verifier so nguyên văn với code block trong docs và ghi hash. Assistant không ký thay owner, không điền giá trị edge/alert chưa có evidence. Các ghi chú kỹ thuật ngoài khối quote vẫn phân biệt retry window khoảng120s với hard deadline I/O.

**B-A1-AV01 là P2 còn mở**, được owner chấp nhận theo văn bản trên. Read auth/A1 ngoài transaction giữ budget5s; không đổi transaction/commit. Deadline edge và cảnh báo readiness/p99 ở đích chưa xác minh. Phải đóng issue bằng A2 hoặc quyết định khác có bằng chứng trước staging người dùng thật/mở bán; xem lại sau DR03/DR05 và phase tải. Các P2 khác trong BE-open-issues không tự được đóng hoặc chấp nhận thêm từ quyết định này.

[FE-BE-contract-handoff](FE-BE-contract-handoff.md) nhấn mạnh create/prepare/terminate5xx/503/timeout là **KẾT QUẢ CHƯA RÕ**: giữ nguyên user/kind/key/body và lookup/resolve/replay; chưa có hash thì dùng đúng prepare/terminate-with-body theo contract, không tự mở key mới. Ca đã commit nhưng trả503 phải replay cùng key/body ra201/kết quả cũ, đúng một nghĩa vụ. Không sửa FE, API/auth/4xx hoặc hash/canonicalization.

## Image và gate chạy lại

Image A1 cũ khớp toàn bộ src nhưng lệch `scripts/run-be-tests.js` với host. Hai probe chẩn đoán exit1/cleanup0 được giữ; phân loại **harness — candidate artifact chưa khớp host**, không phải lỗi nghiệp vụ hoặc quyền dùng image cũ làm evidence mới. Build tag UUID mới, không sửa tag/image/container gốc: **`sha256:df340811dbc2b42af618786d0aa7d5ac124ea1c15166318c4c1a7ee29c480bc7`**. Build/probe/hygiene/cleanup0; Node24, UID1000, bcrypt thật; source src/scripts/package/lockfile so byte hash với host. Runtime check riêng và checks trong từng topology đều lưu file hashes. Image candidate mới giữ lại cho review; tài nguyên container/network tạm phải absent.

- **Strict boot:21 pass/0 fail**, runner0/cleanup0, trên image cuối. Không lấy kết quả strict trước auth/A1 làm thay thế.
- **Phase5:12 pass/0 fail/0 skip/0 not-run**, runner0/cleanup0, runtimeTreeMatches=true. B06 assertion bodies giữ nguyên; auth/session/attempt/SSE/HTTP-loss và restart qua HTTPS/hai server.js thật.
- **Bốn fault:4 pass/0 fail/0 skip/0 not-run**, runner0/cleanup0. Mỗi ca topology/UUID mới, một fault tại một thời điểm: Redis stop/start; Redis pause/unpause; Mongo network disconnect/reconnect; backend SIGKILL/restart. Ba ca dependency kiểm readiness/live/login/create/requestId/SSE, snapshot và same-key replay sau recovery. Ca backend xác minh PID1 exit137, backend sống sót replay rồi instance restart replay; một nghĩa vụ/stock99. Recovery/finally vẫn chạy khi assertion lỗi. Logs thô được guard trước khi xuất trường đã lọc.
- **Code91 hợp đồng cố định:1 pass**, runner0/cleanup0. Commit thật được Mongo trả ok1/writeConcernError91/UnknownTransactionCommitResult; observer trực tiếp thấy một nghĩa vụ khi reply còn bị giữ. HTTP gốc **503/5222ms**; ba replay qua hai backend đều201/cùng kết quả, một Checkout/Order/created Attempt, stock99, ledger COD0 và session/coupon giữ nguyên. Số commit chỉ là diagnostic, không có assertion “hai commit” cho ca này.

Code91 có một attempt trước exit1/cleanup0: Mongo đã commit nhưng driver phục hồi kịp, HTTP201/5165ms, nên chưa tái hiện nhánh503. Phân loại **harness — fault chưa cố định điều kiện response503**, không phải mất/trùng dữ liệu; giữ nguyên artifact. Lượt cuối bật chế độ proxy giữ discovery replies trong cửa sổ code91 rồi phục hồi trước replay; có thể chưa có heartbeat reply tới trong cửa sổ đó. Không đổi BE/server selection/session/transaction/commit/retry timeout, không nới assertion503 hoặc invariant để nhận xanh. Không sửa runner1 của ca91 lịch sử A2-0 thành pass.

## B01 và quality

B01 HTTP mới tại `artifacts/b01/http-b4VjBq/`: **16 pass/0 fail/0 skip**, Jest0/runner0/cleanup0; coverage gate N/A ở HTTP (`coverageExitCode:null`). Không dùng số liệu lịch sử thay lượt mới.

B01 full mới tại `artifacts/b01/all-dixmO1/`: **724 pass/0 fail/0 skip, 75 suite pass**; Jest0/coverage0/runner0/cleanup0. Coverage policy v2, tám module không lỗi; không đổi hash/threshold/baseline trong lượt này. Không cộng các lần chạy thành test độc lập.

Sau full, policy verifier được sửa riêng điều kiện quan sát: yêu cầu discovery đã recovery, không yêu cầu một heartbeat reply nhất định phải tới trong cửa sổ fault. Assertion503, commit-before-ACK, replay201, same key/body và một nghĩa vụ giữ nguyên. **14 unit test verifier chạy lại riêng, exit0**; không thay bằng chứng hạ tầng hoặc chạy lại full để cộng số. Quality cuối: **lint0, format:check0, validate:api0**, từng command.json riêng; lint18 debt/0 violation mới, API11 operations/8 examples. `git diff --check` được ghi riêng; verifier từ chối seal nếu bất kỳ gate bắt buộc nào không exit0.

Các test mới của policy verifier kiểm refusal khi thiếu command, có skip, trùng scenario, cleanup lỗi, image cũ, coverage lỗi, owner quote đổi, nghĩa vụ trùng, body đổi, proof commit-before-ACK sai, manifest thêm/mất/sửa file, hoặc seal sửa status/gate/backlog. Đây là unit test verifier; không gọi chúng là Mongo/Redis thật. Các gate phía trên chạy hạ tầng thật riêng.

## Backlog, seal và cleanup

Snapshot `unbudgeted-transaction-calls.json` và danh sách trong BE-open-issues có **11 call/6 file**, giữ cùng file set và predicate `call.arguments.length < 2` của verifier A1. Bao gồm prepare/resolve (terminate dùng chung resolve), checkout create/cancel/resolve-inventory/confirm-COD, subscription create/cancel/fulfillment, payment command, expiry. Mỗi call có file/line/scope, severityP2/stateopen và owner đề xuất theo BE commerce/checkout/subscription/payment/workers + database maintainer; finance reviewer cho payment. Chưa phải giao việc, không suy toàn bộ đã fault-test.

Verifier mới: `tests/helpers/roundB/close-seal.js --seal` rồi `--check`. Verifier bắt buộc raw owner quote, gate counts/status/exit, coverage không đổi policy, image/runtime hashes, complete source/evidence path sets, backlog khớp AST hiện hành, historical hashes và original container/image inventory. B01 resource IDs và tài nguyên Lease mỗi attempt được kiểm absent độc lập; port Mongo identity fixtures phải đóng. Seal ghi P2 còn mở/owner-provided text hash, điều kiện hết hạn, unknown mitigations, candidate image giữ lại, productionReady=false và roundCAuthorized=false. Không sửa tay seal hoặc evidence gốc.

Chỉ thay docs/test helpers và thêm unit test verifier. Không đổi src/scripts/tooling/package hoặc chạy migration/provider dùng chung; chỉ fault và cleanup exact ID/label đã tạo. Lint đầu phát hiện9 unused vars ở verifier mới (exit1); đã sửa code, không đổi baseline. Kết quả quality cuối là căn cứ nghiệm thu. Không dùng kết quả cũ hoặc risk downgrade để bỏ gate mới.
