
function LoggingPage() {
    // Fields and such
    var mLogWorkersText = $("#edit_log_workers");
    var mLogFilterButton = $("#btn_log_filter");
    var mStartStopButton = $("#btn_log_start_stop");
    var mLogBox = $("#txt_log_output");
    var mListening = false;

    var mEventListener = {
        onMessage: function(msg) {
            // console.log(`onMessage(): ${msg}`);
            var jo = JSON.parse(msg);

            // {"event":"worker-log-gcs","data":{"worker_id":"another_test_worker","message":"Found another worker: test_worker"}}
            switch(jo.event) {
                case "worker-log-gcs": {
                    var workerId = jo.data.worker_id;
                    // console.log(`message=${jo.data.message}`);
                    var val = mLogBox.val();
                    var out = (val) ? val + "\n" + workerId + ": " + jo.data.message : workerId + ": " + jo.data.message
                    mLogBox.val(out);

                    mLogBox.scrollTop(mLogBox[0].scrollHeight - mLogBox.height());
                    break;
                }
            }
        }
    };

    function setButtonStates() {
        var workerIds = mLogWorkersText.val();

        enable(mLogFilterButton, (workerIds));
    }

    function onSetFilterClick() {
        var workerIds = mLogWorkersText.val();

        $.getJSON("/dispatch/log_filter/" + workerIds, function(data) {

        });
    }

    function onStartStopClick() {
        console.log(`onStartStopClick(): listening=${mListening}`);

        if(mListening) {
            stopListening();
            mStartStopButton
                .removeClass("btn-danger")
                .addClass("btn-success")
                .text("Start");
        } else {
            mLogBox.val("");
            startListening();
            mStartStopButton
                .removeClass("btn-success")
                .addClass("btn-danger")
                .text("Stop");
        }

        mListening = !mListening;
    }

    function startListening() {
        addWebSocketListener(mEventListener);
        sendWS({ id: "web-log-listener", type: "subscribe-log" });
    }

    function stopListening() {
        removeWebSocketListener(mEventListener);
        sendWS({ id: "web-log-listener", type: "unsubscribe-log" });
    }

    function loadPage() {
        mLogWorkersText.keyup(setButtonStates);
        mLogFilterButton.click(onSetFilterClick);
        mStartStopButton.click(onStartStopClick);

        enable(mLogFilterButton, false);

        $.getJSON("/dispatch/log_filter", function(data) {
            var workerIds = data.worker_ids;
            mLogWorkersText.val(workerIds);
        });
    }

    loadPage();
}

$(document).ready(function () {
    LoggingPage();
});
