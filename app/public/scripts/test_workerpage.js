
function TestWorkerPage() {
    // Fields and such
    var mWorkerIdText = $("#edit_worker_id");
    var mPostBodyText = $("#post_body");
    var mResponseBodyText = $("#response_body");
    var mSendButton = $("#btn_send");

    function setButtonStates() {
        var workerId = mWorkerIdText.val();
        var postBody = mPostBodyText.val();

        enable(mSendButton, (workerId && postBody));
    }

    function onSendClick() {
        // post(url, content, successCallback, failCallback)
        var workerId = mWorkerIdText.val();
        var postBody = mPostBodyText.val();
        var postJSON = JSON.parse(postBody);

        post("/worker/msg/" + workerId, postJSON, function(output) {
            mResponseBodyText.val(JSON.stringify(output));
        }, function(err) {
            alert("Error sending message: " + JSON.stringify(err));
        })
    }

    function loadPage() {
        mWorkerIdText.keyup(setButtonStates);
        mPostBodyText.keyup(setButtonStates);
        mSendButton.click(onSendClick);

        enable(mSendButton, false);
    }

    loadPage();
}

$(document).ready(function () {
    TestWorkerPage();
});
