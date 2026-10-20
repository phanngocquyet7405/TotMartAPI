# B04 — refresh rotation, reuse và family revocation

Ngày 20/10/2026. Đầu mối B04; dừng sau B04, chưa chuyển B05. Đã đọc AGENTS.md, [B01](B01-verification.md), [B02](B02-verification.md), [B03](B03-verification.md), [state machine](refresh-family-policy.md) và [kiểm chứng chọn lọc trước đó](refresh-family-verification.md). Giữ thay đổi hiện có; không lấy kết quả B01–B03 hoặc 64 test chọn lọc làm kết quả snapshot hiện tại.

Trạng thái: **B04 đạt kiểm chứng local trên snapshot cuối: HTTP 12/12 và full 60 suite/508 test, 0 fail/0 skip; Jest/runner exit 0.** Đã đối chiếu snapshot, artifact và cleanup. CI và staging thật chưa kiểm chứng. Dừng sau B04.

## Review retry và thông tin phục hồi

- Hai refresh cùng token: transaction cùng ghi AuthSession nên serialize/write-conflict retry. Request đầu chuyển current hash sang successor và thêm consumed hash; request còn lại chỉ tăng retry counter và cấp lại cùng successor nếu successor còn current. Không tạo hai nhánh family.
- Commit nhưng response mất: hash cũ, consumedAt, retries và current hash đã nằm trong cùng document DB. Client vẫn trình token cũ; HMAC-SHA384 với domain `totmart-refresh-v1`, sid và token trình lại, dùng JWT_REFRESH_SECRET ổn định giữa process, tái tạo successor trong RAM. DB không lưu raw/encrypted refresh token; không cần cache token để phục hồi.
- Process chết rồi restart: thông tin phục hồi ở DB và khóa cấu hình ổn định; không phụ thuộc bộ nhớ process cũ. Fixture HTTP mới hủy response sau khi transaction đã commit, báo IPC chỉ một event generic, SIGKILL đúng backend do phiên tạo rồi spawn backend mới; kiểm PID thay đổi, hai process cấp lại cùng successor và counter trong DB tăng đến 2.
- Successor đã rotate tiếp trước khi request cũ được xác thực: successor tính từ token cũ không khớp current hash, nên revoke đúng family và 401. Không cấp lại ancestor. Response đã được chấp nhận từ trước vẫn có thể về sai thứ tự và ghi đè cookie: HTTP Set-Cookie không có CAS. Không tuyên bố giải quyết mọi race của browser bằng server retry policy.

Retry chỉ hợp lệ tối đa **2 lần**, tuổi consumed hash **nhỏ hơn 30 giây**, successor còn current, family chưa revoke/chưa hết hạn, user còn active và tokenVersion khớp. Không gia hạn expiry. Không coi IP/user-agent là bằng chứng phân biệt chủ sở hữu. Trong cửa sổ này, attacker giữ token cũ cũng có thể được chấp nhận theo cùng chính sách. Retry hợp lệ đến muộn hoặc sau khi successor tiến tiếp có thể gây logout. Duplicate không chứng minh chắc chắn theft; đây là tradeoff phục hồi và phát hiện suspected reuse. Các mốc thời gian logic hiện dùng đồng hồ app; vận hành cần đồng bộ clock, chưa kiểm drift giữa máy thật.

## Giới hạn, expiry, index và cleanup

AuthSession giữ tối đa 4096 consumed hashes; không cắt đầu mảng để nhận rotation mới. Test mới tạo 4095 entry, rotate lên đúng 4096, kiểm mọi hash cũ và hash cuối còn nguyên, retry cuối vẫn có thể phục hồi theo budget; rotation current tiếp theo trả 401/revoke và vẫn giữ đủ 4096 entry. expiresAt không thay đổi khi rotate/retry/revoke.

Family có hạn tuyệt đối 30 ngày từ login. Auth HTTP/SSE/refresh kiểm expiry và revokedAt trong query/logic, kể cả TTL chưa dọn; access JWT còn hạn cũng không vượt được expiry của family. Test đọc index thật: unique sessionId, unique refreshHash, multikey history.hash, TTL expiresAt/expireAfterSeconds=0. Test TTL trên mongod riêng đặt ttlMonitorSleepSecs=1 và quan sát document tự mất; đây là cấu hình fixture để kiểm cleanup, không phải cam kết TTL production xóa trong 1 giây. TTL có thể chậm/ngừng khi Mongo lỗi; dữ liệu đã hết hạn vẫn bị từ chối. Không xóa evidence còn hiệu lực để mở quota.

Logout/reset giữ cơ chế cũ xóa family trong transaction và ghi security outbox: sau khi xóa không còn attribution từ history, nhưng mọi access/refresh của sid đó vẫn bị từ chối; không phục hồi family bằng reuse.

## Hai process, Mongo/Redis thật và SSE

Mở rộng suite HTTP hiện có, không mở endpoint điều khiển trong src. Hai backend thật dùng chung một MongoDB 7.0.14/WiredTiger replica set disposable và Redis 7.4 Alpine riêng cho suite; Redis primitives của runner là container khác. Harness xác minh ID, UUID label, tên, binding loopback, URL và PONG trước thao tác; outage/restart/cleanup chỉ nhắm lease của phiên. Không dùng TEST_REDIS_CONTAINER làm ownership.

- HTTP concurrency/reuse chạy qua hai process, junk malformed và token đúng định dạng nhưng không tồn tại không revoke family khác. Access JWT của family đã revoke bị chặn ở cả hai process; family thứ hai của cùng user vẫn access/refresh được.
- Reuse ở process A đóng SSE của đúng sid tại B qua outbox worker/Pub/Sub thật. Hai stream cùng user nhưng sid khác vẫn mở. Dừng riêng hai security worker fixture để không phát tín hiệu: DB revocation vẫn chặn access, stream target đóng ở heartbeat 20 giây, stream sid khác vẫn mở. Sau đó bật lại worker.
- Stop đúng Redis fixture: health và refresh limiter fail-closed 503; streams của các family đều có thể đóng theo chính sách outage toàn hệ thống. Vì HTTP refresh đang bị chặn bởi Redis limiter, thao tác revoke trong outage gọi service transaction từ process test có kết nối DB thật; không trình bày đây là refresh HTTP thành công trong outage. Cả hai backend vẫn trả 401 cho access family đã revoke và 200 cho access family khác. Outbox pending bền vững, sau Redis recovery publish lại; family bị revoke không sống lại, family khác refresh và mở SSE lại được. Redis primitives khác vẫn PONG.

Mốc công bố: đóng local sau commit; remote theo Pub/Sub khi nhận được; nếu mất tín hiệu, heartbeat kiểm DB mỗi 20 giây cộng latency DB/event loop. Không có hard bound khi query bị treo. Fixture assert Pub/Sub dưới 8 giây và heartbeat/outage dưới 23 giây (allowance scheduling/DB local); đây không phải SLO production. Thời gian quan sát của từng lượt nằm trong b04-http-evidence.json, không chứa token/secret.

## Lệnh, snapshot và kết quả

Node 24.14.1/Windows; Docker Desktop Linux 29.1.3. Docker trong sandbox bị từ chối pipe; kiểm tra lại với quyền được duyệt exit 0. Không coi lỗi quyền ban đầu là kết quả nghiệp vụ.

- Selected `npm test -- --runTestsByPath tests/refreshFamily.integration.test.js tests/cookieSessions.integration.test.js tests/sessionProxyFixture.test.js tests/sessionPolicy.test.js`: 4 suite/15 pass/0 fail/0 skip, exit 0. Đây là snapshot trước khi tăng assertion cookie test cuối; full cuối phải chạy lại trên snapshot cuối.
- HTTP đầu `artifacts/b01/http-5OS3Hw/`: Jest/runner exit 1, 11 pass/1 fail/0 skip. Các scenario B04 setup và chạy được; quota test cũ lỗi `The client is closed` vì drill outage mới chạy trước đó đã đóng Redis observer parent có reconnect=false. Sửa reconnect đúng client fixture sau recovery và assert PONG, không nới quota hay xóa assertion. Không gọi đây là lỗi môi trường để bỏ qua.
- HTTP sau sửa `artifacts/b01/http-8JrCta/`: Jest/runner exit 0, 1 suite/12 pass/0 fail/0 skip, 60,980 giây. Bao gồm tám test HTTP cũ và bốn scenario B04 mới.
- Full đầu `artifacts/b01/all-cEYDym/`: Jest/runner exit 1, 59/60 suite pass, 506 pass/2 fail/0 skip, 257,144 giây. Hai guard test trong httpSetupFailure vẫn đếm 8 case trong khi HTTP suite đã có 12. Đổi số đếm chính xác thành 12, giữ exit 1, pending=0, đúng lỗi cấu hình và không timeout teardown. Setup/Redis và 12 case HTTP thực đều pass; đây vẫn là lượt full thất bại, không phải lỗi môi trường hay full pass.
- HTTP cuối sau sửa guard `artifacts/b01/http-corWh4/`: 1 suite/12 pass/0 fail/0 skip, Jest/runner exit 0, 61,046 giây.
- Full cuối `artifacts/b01/all-kbftRH/`: **60 suite/508 pass/0 fail/0 skip**, Jest/runner exit **0**, 238,787 giây. Gồm 12 HTTP case qua hai backend/Redis thật, 3 Redis primitives case thật, 10 refresh family case, 2 setup guard case và toàn bộ regression hiện có. Không skip suite Redis.

Hai lượt cuối có cùng manifest **199 file** src/tests/scripts và package/config; SHA-256 của source-sha256.json là `630922aa551729c8664b713856662dd781ab05add26ed740c5b3c7f96f35cde9`. Đã tính lại toàn bộ hash sau khi runner thoát: không có file mới/thiếu/hash khác working tree. HEAD nền `84cef8973f2b2d88fa6d19454dab88fb40bf1c5c` không đại diện toàn bộ diff B02–B04 chưa commit; dùng manifest để nhận diện snapshot. Manifest không bao gồm tài liệu tổng hợp sau test hoặc artifact ignored. Không sửa source/test sau snapshot cuối.

Thời gian quan sát HTTP cuối: restart/recovery 1956 ms; đóng SSE qua Pub/Sub 118 ms; fallback DB heartbeat 19695 ms; đóng streams khi Redis outage 458 ms. Trong scenario B04 của full cuối: lần lượt 1965/63/19801/463 ms. Các số này là quan sát local, không phải latency SLA hoặc bằng chứng mọi failure mode đã được kiểm.

Runner lọc raw Jest JSON trước khi công bố: chỉ count/name/status/duration, source hashes, resource metadata, coverage; raw JSON tạm được dọn. Không lưu token/cookie/body/log thô vào artifact B04. HTTP coverage không instrument subprocess; không suy diễn coverage đó thành độ phủ E2E. Không thêm threshold tùy ý.

`node artifacts/b04/verify-final.cjs artifacts/b01/http-corWh4 artifacts/b01/all-kbftRH` exit 0; summary [final-verification.json](../artifacts/b04/final-verification.json) ghi valid=true, hai manifest giống nhau, đếm lại trực tiếp 12/508 trạng thái passed. Rà mẫu JWT, URI có credential, private key và raw refresh 96 hex trên cả năm thư mục artifact của phiên: mỗi nhóm 0 match; đây là kiểm tra mẫu, không phải chứng nhận an toàn tổng quát. Chỉ lưu hash source, metadata tài nguyên test và timing generic.

Metadata cả năm lượt ghi cleaned=true; kiểm Docker read-only có quyền xác nhận **10 ID Redis do phiên tạo đều không còn**, gồm các lượt fail. Mỗi container có owner/ID/binding riêng và tmpfs, không volume persistence. Mongo/backend fixture do helper tạo, close/stop theo reference/child handle; không kill process hàng loạt, không prune/chạm tài nguyên dùng chung. Một truy vấn Win32_Process trong sandbox bị Access denied; không dùng truy vấn thất bại đó để khẳng định inventory process toàn máy. Không có claim toàn máy không còn Node/mongod.

Baseline full src: statements 70,12% (3058/4361), branches 64,95% (1529/2354), functions 68,33% (436/638), lines 73,74% (2707/3671); không threshold hay suy luận production readiness. `git diff --check` chạy lại sau hoàn thiện tài liệu, exit 0. Không có lint/build trong package, không báo chạy các lệnh đó; không audit fix hoặc nâng dependency.

## Kiểm tra test cũ và phạm vi sửa

Cookie replay expectation 401→200 là đổi hợp đồng có chủ đích theo bounded retry, không bỏ kiểm rotation. Lần khép tăng assertion: successor phải khác token ban đầu, hai retry phải trả cùng successor, retry thứ ba 401, DB có revokedAt và access JWT successor bị chặn. So sánh token bằng boolean để lỗi assertion không in token. Test concurrency được đổi tên từ “module restart” thành gọi service lặp trong cùng process vì xóa require.cache trong Jest không chứng minh restart; test restart thật nằm ở subprocess và HTTP drill.

Đối chiếu các diff cũ của B03: customerFeatures/provider failure 500→200 kèm body chung và kiểm cleanup; passwordResetStreams 500→200/body bằng response thành công nhưng giữ token mới và reset được/SSE closure; userAuthorization chỉ thêm mock updateOne để phục vụ CAS. Đây là thay đổi đã được B03 ghi, không sửa giảm assertion trong lần khép B04. Quota isolation chỉ reset loopback key giữa scenario độc lập trong suite refresh, không giữa request của một scenario và không nới limiter runtime; rateLimiter và Redis quota tests giữ nguyên.

Lần khép chỉ sửa tests/cookieSessions.integration.test.js, tests/refreshFamily.integration.test.js, tests/redisHttp.integration.test.js, tests/helpers/http-process.js, tests/httpSetupFailure.test.js, các tài liệu B04/refresh-family và ghi chú B04 trong UNIFIED-COMMERCE-CONTRACT.md. Không đổi runtime src trong lần khép. Implementation B04 hiện có được giữ nguyên; danh sách file runtime nằm trong biên bản refresh-family trước đó. Script/summary kiểm chứng bổ sung nằm trong artifacts/b04 ignored, không sửa runner hay dependency.

## FE, index/migration, legacy và rollback

FE đã được đối chiếu chỉ đọc ở đường dẫn được cung cấp trong đợt B04 trước; giữ claim name/email. Không sửa FE. POST /api/home/refresh vẫn cookie/CSRF và success/token; bounded duplicate có thể 200, out-of-policy 401 và revoke sid. Nhiều tab/runtime vẫn có thể tranh chấp hoặc vượt budget; không tuyên bố browser E2E đã pass.

Không cần backfill dữ liệu để đọc session opaque đang active. Bổ sung history/revokedAt và index history.hash là additive; startup init/createIndexes phải thành công trước traffic. Giữ unique indexes sid/current hash và TTL; không drop/syncIndexes. Chưa áp dụng index/migration trên dữ liệu dùng chung. Refresh đã tiêu thụ trước cutover không có lịch sử để khôi phục/nhận diện family; từ chối unknown, không tự suy ra ownership/reuse. Token legacy thiếu sid và JWT refresh cũ cần login lại khi bật strict staging/production; không có fallback HTTP/SSE khi thiếu sid.

Đóng refresh traffic, đồng bộ code/index trên tất cả instance rồi mở lại; không hỗ trợ mixed old/new writers. JWT_REFRESH_SECRET phải giống nhau và ổn định; key rotation cần revoke/session login lại có kế hoạch. Rollback chỉ về bản vẫn kiểm revokedAt và sid; invalidate family bị ảnh hưởng rồi yêu cầu login trước khi mở traffic. Không rollback về code bỏ qua tombstone vì có thể tái kích hoạt access JWT. Không phục hồi token cũ hoặc xóa evidence để ép rollback.

## Giới hạn và điểm dừng

Chưa staging thật, TLS/browser cookie jar thật, clock-skew đa máy, Redis HA/Sentinel/Cluster, Mongo đa node failover, mất Mongo commit acknowledgement thật hoặc provider ngoài hệ thống. HTTP drill mất response ứng dụng sau commit là kiểm chứng riêng, không đồng nghĩa unknown commit-result của Mongo. Proxy test là hai server HTTP loopback giả lập TLS termination bằng forwarded header, dùng middleware app thật; SSE event/timer mocks trong suite refresh vẫn là mock, khác SSE HTTP thật ở suite Redis. CI chưa chạy; không dùng local pass làm production readiness. Các giới hạn B01–B03 còn nguyên.

Không sửa FE, commit/push/deploy, migration/dữ liệu/volume dùng chung. Dừng sau B04.
