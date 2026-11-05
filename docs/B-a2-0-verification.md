# Đợt B — ngoại lệ B03, B01 full, ledger 300007 và A2-0

Lượt đóng mới theo yêu cầu owner được ghi tại [B-close-verification](B-close-verification.md). Ca91 được giữ thành regression hợp đồng riêng (commit đã áp dụng,503 gốc,replay201,một nghĩa vụ; không yêu cầu hai commit). Raw attempt/exit lịch sử A2-0 phía dưới giữ nguyên. Đóng Đợt B với P2 B-A1-AV01 còn mở, không triển khai A2-1/A2-2 hoặc Đợt C.

Cập nhật sau nghiệm thu A2-0: owner **Q, ngày22/10/2026** đã hạ **B-A1-AV01 P1→P2 và chấp nhận rủi ro có điều kiện**, issue còn mở; [hồ sơ quyết định](BE-open-issues.md). Các nhãn P1/chưa có acceptance trong biên bản dưới đây là trạng thái tại lúc chạy, giữ làm lịch sử. Không đổi raw evidence hoặc coi120s là hard deadline. Chưa làm A2-1/A2-2; phải đóng issue trước staging có người dùng thật hoặc mở bán, xem lại sau DR03/DR05 và phase tải.

Ngày 22/10/2026. Cwd đã xác minh đúng TotMartAPI; HEAD `62bbb6001728523bf04654bf4aa952f30d99e738`, tag `round-a-checkpoint`. Không có tag `round-b-checkpoint-2` (lệnh verify tag exit 1). Giữ working tree bàn giao. Không đổi thêm file `src/`, FE, script migration identity hoặc seal A; không commit/push/merge/deploy. **Dừng sau A2-0; P1 availability transaction/commit vẫn mở, Đợt B chưa đạt và không vào Đợt C.**

Evidence lượt này: `artifacts/round-b/a2-0/6d74d41c-abf9-4ca8-b4d0-c9431a825748/`. Node host24.14.1, Docker Engine29.9.1; A2 dùng lại image A1 `sha256:1b99bfd6902d2020ba0d980847f3c80d7b3ca1a2456db97314968428d8c5f991`. Runtime toàn bộ src/package/lockfile trong image được so byte hash với host trước mỗi ca. `entry.json` và `delivery.json` lưu provenance/integrity; không phải seal mới.

## 1. Ngoại lệ index chỉ trong identityMigrationB03

`ownedIdentityMigrationFixture` bọc callback của chính `withDisposableIdentityDb`, chỉ interpose `Collection.dropIndex` trong test. Trước drop kiểm cùng client, host loopback/port do helper cấp, database `totmart_test`, processId từ hello/PRIMARY, collection `users`, UUID marker và đúng name/key/unique; descending còn kiểm sparse. Chỉ cho phép `legacy_custom_display` `{name:1}, unique:true` và `custom_display_desc` `{name:-1}, unique:true, sparse:true`. Sai thì throw trước drop; sau drop kiểm absent và xuất `identity-migration-<UUID>.json`. Không dùng dropIndexes/syncIndexes; hash `scripts/review-user-identity.js` giữ nguyên.

Test âm riêng gọi apply với object target không sở hữu: bị từ chối trước khi gọi collection. Test âm DB khác và collision/stale/partial-index/rollback hiện có giữ nguyên. Selected `a2-check.js tests/identityMigrationB03.test.js`: **6 pass/0 fail/0 skip**, exit0, tại `selected-2R7kNd/`. Các fixture này và hai full run đều được teardown; kiểm độc lập **15 port Mongo identity ECONNREFUSED** ở cuối.

## 2. B01 full và coverage review

`a2-check.js --full` gọi đúng **`npm run test:b01`**, giữ output thô riêng trong process, chỉ công bố artifact đã lọc của runner.

- Lượt đầu `artifacts/b01/all-zkFl0r/`: **706 pass/2 fail/0 skip**, 71 suite pass/2 fail; Jest1, coverage1, runner1, cleanup0. Hai lỗi unit đã tái hiện riêng: `qrFlow` thiếu Query.setOptions/thenable chain và `mergedMerchant` thiếu setOptions sau session. Phân loại **harness**, không phải lỗi môi trường hoặc assertion nghiệp vụ được bỏ qua. Chỉ bổ sung mock Query API, giữ status/ownership/money assertions. Ba suite liên quan sau sửa **29/29**, exit0 (`selected-OHChAZ/`).
- Coverage v1 từ chối đúng hash của Attempt/Catalog và instrumentation Catalog mới. `coverage-instrumentation-review.json` chứa branch maps/source snippets trước/sau, source cũ khớp hash policy. Attempt giữ **61 total, minimum54 covered**; Catalog thêm đúng ba default-argument branches cho readOptions: **109→112 total**, minimum covered **74→77**. Bổ sung test gọi service với options mặc định vẫn ràng buộc owner/refuse foreign resources; không hạ threshold hoặc bỏ branch. Sáu module khác giữ nguyên policy. Policy v2 ghi lý do/evidence; lint baseline không đổi.
- Lượt cuối `artifacts/b01/all-qQbF34/`: **709 pass/0 fail/0 skip, 73 suite pass**; **Jest0/coverage0/runner0/cleanup0**, tám module coverage gate không lỗi. Catalog thực đạt77/112. Đây là full trước khi thêm test ledger riêng bên dưới; không gọi đó là full710.

## 3. Ledger 300007: source và B06

Căn cứ chính xác trong `src/services/paymentReconciliationService.js`:

```js
// applyReceipts, dòng 192: mỗi allocation giữ toàn receipt
[{ eventId: event._id, checkoutId: checkout._id, amount: money(event.transferAmount) }],
// applyReceipts, dòng 201
checkout.receivedAmount = sumMoney(allocations.map((a) => a.amount));
```

`settle` dòng131 tính `const surplus = checkout.receivedAmount - checkout.totalAmount;`. [B06-invariants](B06-invariants.md), dòng30 quy định: “Each checkout's `receivedAmount = sum(allocations for that checkout)`” và “**do not add surplus to E or A again**”. Dòng32: `A = retained principal + pending allocated refunds + completed allocated refunds`. Surplus nằm trong allocation, là nghĩa vụ hoàn trong khoản đã nhận; không phải tiền nhận thêm.

`tests/ledger300007.integration.test.js` chạy HTTP thật trong Jest với MongoMemoryReplSet riêng: subscription principal300000, receipt100001 rồi200006; receipt đầu còn pending, receipt sau active, received/allocation **300007**, surplus pending7. Replay cả hai receipt trước/sau hai lần cancel: vẫn hai event/hai allocation distinct; principal refund300000 + surplus7 = **tổng pending300007**, completed0, retained0; Subscription.refundAmount chỉ300000. Stock Product/Box giữ10 vì chưa dispatch. Không sửa BE hoặc luồng tiền.

`a2-check.js tests/ledger300007.integration.test.js tests/commerceInvariants.integration.test.js`: **6 pass/0 fail/0 skip**, exit0 (`selected-ftDm3G/`). Sau khi viết tách rõ pending/completed trong phương trình, test ledger cuối chạy lại **1/1**, exit0 (`selected-F9MAh7/`). Đây là verification riêng, không cộng các lần chạy thành test độc lập.

## 4. A2-0 — đặc tả trên code BE hiện tại

`node tests/helpers/roundB/a2-commit-image.js`: lượt cuối **2 pass/0 fail/0 skip/0 not-run**, runner0/cleanup0, tại `commits-925443db-0dc2-4926-919f-c5e55c8e17ff/`. Mỗi ca topology/UUID/Mongo/Redis TLS riêng, hai server.js production/staging sau HTTPS proxy. Trước fault xác minh exact container IDs/label, database marker và Mongo processId. Prepare trước bằng đúng key/body để nhắm commerce commit, không nhắm nhầm commit prepare.

Proxy Mongo chuyển nguyên commit tới server, ghép responseTo với requestID/transaction hash, giữ toàn bộ reply. Observer client độc lập kết nối **trực tiếp Mongo**, đọc snapshot transaction trong lúc reply còn bị giữ và HTTP gốc chưa xong. Sau đó mới release/drop; không thay I/O bằng mock hoặc mất HTTP response. Preload chỉ theo dõi commands; không thay session, transaction, timeout hoặc retry options BE.

Thiết kế harness đối chiếu [wire protocol MongoDB](https://www.mongodb.com/docs/manual/reference/mongodb-wire-protocol/) và [failCommand trong source MongoDB](https://raw.githubusercontent.com/mongodb/mongo/r7.0.14/src/mongo/db/commands.cpp); kết luận pass dựa trên evidence chạy thật ở trên.

- **Server-injected UnknownTransactionCommitResult, commit đã áp dụng:** failCommand `times:1`, appName production, writeConcernError64/WriteConcernFailed và label UnknownTransactionCommitResult. Server reply `ok:1` có lỗi/label thật, proxy giữ tại1792629993449; observer thấy một nghĩa vụ tại1792629993599 trước release. Backend quan sát label và gửi **hai commit cùng transaction hash**. HTTP gốc201/243ms; replay qua production/staging/production đều201, cùng result và đúng key/body đã lưu.
- **Mất ACK Mongo sau commit thật:** reply commit `ok:1`, không writeConcernError, bị giữ tại1792630066533. Observer thấy một nghĩa vụ tại1792630066767; tới1792630066770 proxy mới hủy socket và bỏ reply, không chuyển ACK tới backend. Backend ghi MongoNetworkError và **hai commit cùng transaction hash**. HTTP gốc201/368ms; ba replay qua hai backend đều201 và cùng result.

Trước khi release/drop và sau mọi replay, cả hai ca đều **một Checkout, một Order, một created Attempt, stock99**, ledger COD0, coupon không đổi, sessions không đổi, result/order linkage khớp. Không thấy trùng hoặc mất nghĩa vụ trong hai fixture này; không có P0 được chứng minh. Log guard không phát hiện disclosure.

Lượt A2 đầu được giữ tại `commits-bc2b4b3c-f628-4517-8ffa-9accf0828169/`: runner1/cleanup0, pass0/fail1/not-run1 theo tiêu chí runner. Cấu hình code91/ShutdownInProgress đã chứng minh commit trước ACK, HTTP gốc503/5218ms, ba replay201/cùng result và snapshot một nghĩa vụ; nhưng chỉ thấy một commit trên wire nên tiêu chí bổ sung retryProven đỏ. **Phân loại harness — cấu hình fault/tiêu chí quan sát retry**, không phải assertion money/stock sai hoặc lỗi môi trường. Tác động SDAM của code91 khiến lượt này không cô lập riêng lỗi write-concern; nguyên nhân chi tiết của khoảng5s chưa được trace đầy đủ, không gọi đó là budget được chứng minh. Đổi code64 để cô lập ca cần đo, giữ nguyên mọi assertion và evidence cũ, chạy lại hai ca; không nới retry≥2 hoặc invariant để nhận xanh.

Giới hạn: A2-0 là COD products trên replica set một node, explicit prepare; ledger subscription được kiểm riêng. Production backend trong fixture dùng directConnection tới proxy để discovery không đi vòng; staging/observer đi trực tiếp Mongo. Không suy ra kết quả multi-node failover/partition, mọi nhánh online/coupon/box/subscription commit hoặc SLA tổng. P1 transaction/commit chưa có budget vẫn mở. **A2-1/A2-2 NOT-RUN, chờ owner duyệt kết quả này.**

## Cleanup, file và cổng dừng

`a2-delivery.js` exit0: **24 resource Docker A2 exact ID absent**, toàn bộ container/image tag-ID đầu vào còn nguyên, hash src và protected files/seal A không đổi, hai tên index drop được kiểm absent, 15 port identity Mongo đã đóng. B01 hai lượt cleanup0. Không xóa resource dùng chung/image/volume; không migration dữ liệu thật hoặc FE edit.

File sửa của riêng lượt này: `tests/identityMigrationB03.test.js`, `tests/mergedMerchant.unit.test.js`, `tests/qrFlow.unit.test.js`, bổ sung vào `tests/manager.unit.test.js`, `tooling/commerce-coverage-baseline.json`, option fixture trong `tests/helpers/roundB/topology.js`; thêm `tests/helpers/ownedIdentityMigrationFixture.js`, `tests/ledger300007.integration.test.js`, các `tests/helpers/roundB/a2-*.js`; báo cáo này và ghi chú liên kết trong B-a1/B-verification/BE-open-issues. Các thay đổi src/FE-BE handoff có sẵn được giữ nguyên.

Lỗi công cụ khác: Docker/subprocess trong sandbox bị permission denied/EPERM (exit1), chạy ngoài sandbox mới thực thi fixture; phân loại **môi trường/quyền**, không tính test pass hoặc business fail. Format check đầu exit1 ở mergedMerchant, đã format lại; quality cuối và diff check ghi trong `quality.json`. Không thay baseline lint/coverage để che lỗi. Không tuyên bố production-ready, không sinh seal và không chuyển Đợt C.
