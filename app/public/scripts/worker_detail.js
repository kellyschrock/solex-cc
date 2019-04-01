
function WorkerDetailPage(workerId) {
    let workerTitle = $("#worker_title");
    let workerDesc = $("#worker_desc");
    let postBody = $("#post_body");
    let postBodyBytes = $("#post_body_bytes");
    let btnSend = $("#btn_send");
    let responseBody = $("#response_body");
    let responseBytes = $("#txt_response_bytes");
    let wsOutput = $("#ws_output");
    let wsByteCount = $("#txt_ws_bytes");
    let logOutput = $("#log_output");
    let btnMsgPanel = $("#btn_msg_panel");
    let tblMessages = $("#tbl_messages");
    let btnWsPanel = $("#btn_ws_panel");
    let tblWsOutput = $("#tbl_ws_output");
    let btnLogPanel = $("#btn_log_panel");
    let tblLogOutput = $("#tbl_log_output");
    let btnLogClear = $("#btn_log_clear");
    let chkMonitor = $("#chk_monitor_post");

    function formatJson(jo) {
        return JSON.stringify(jo, null, 4);
    }

    // WebSocket listener
    let webSocketListener = {
        onMessage: function onMessage(data) {
            // d(`onMessage(): ${data}`);
            try {
                let jo = JSON.parse(data);
                switch(jo.event) {
                    case "worker-to-gcs": {
                        onGCSMessage(jo.data, data.length);
                        break;
                    }

                    case "worker-log-gcs": {
                        onLogMessage(jo.data);
                        break;
                    }

                    case "monitor-to-gcs": {
                        d(`worker_id=${jo.data.worker_id} workerId=${workerId}`);

                        if(jo.data) {
                            if(jo.data.worker_id == workerId) {
                                let input = formatJson(jo.data.message.input);
                                let output = formatJson(jo.data.message.output);

                                postBody.text(input);
                                postBodyBytes.text(`${input.length} bytes`);

                                responseBody.text(output);
                                responseBytes.text(`${output.length} bytes`);
                            }
                        }

                        break;
                    }
                }
            } catch(ex) {
                d(`Error parsing message: ${ex.messaage}`);
                console.trace();
            }
        }
    };

    function onGCSMessage(jo, len) {
        if (jo.worker_id === workerId) {
            wsOutput.text(formatJson(jo));
            wsByteCount.text(`${len} bytes`);
        }
    }

    function onLogMessage(jo) {
        if(jo.worker_id == workerId) {
            logOutput.append(formatJson(jo));
            logOutput.scrollTop(logOutput[0].scrollHeight - logOutput.height());
        }
    }

    function d(str) {
        console.log(`worker_detail: ${str}`);
    }

    // Set up the page
    setOnPageUnload(function() {
        d(`Unloaded detail page`)
        doMonitor(false);
        unsubscribeWsGCSMessages();
        unsubscribeWsLogMessages();
        unsubscribeMonitor();
        removeWebSocketListener(webSocketListener);
    });

    function loadWorker(workerId) {
        $.getJSON(`/worker/details/${workerId}`, function (data) {
            // d(JSON.stringify(data));
            workerTitle.text(data.name);
            workerDesc.text(data.description);
        });
    }

    addWebSocketListener(webSocketListener);
    subscribeWsGCSMessages();
    subscribeWsLogMessages();
    subscribeMonitor();
    loadWorker(workerId);

    btnMsgPanel.click(function() {
        if(tblMessages.is(":visible")) {
            tblMessages.hide();
            btnMsgPanel.text("Expand");
        } else {
            tblMessages.show();
            btnMsgPanel.text("Collapse");
        }
    });

    btnWsPanel.click(function() {
        if(tblWsOutput.is(":visible")) {
            tblWsOutput.hide();
            btnWsPanel.text("Expand");
        } else {
            tblWsOutput.show();
            btnWsPanel.text("Collapse");
        }
    });

    btnLogPanel.click(function() {
        if(tblLogOutput.is(":visible")) {
            tblLogOutput.hide();
            btnLogPanel.text("Expand");
        } else {
            tblLogOutput.show();
            btnLogPanel.text("Collapse");
        }
    });

    btnSend.click(function() {
        let body = postBody.val();

        postJSON(`/worker/msg/${workerId}`, body, function(output) {
            responseBody.text(formatJson(output));
            let len = JSON.stringify(output).length;
            responseBytes.text(`${len} bytes`);
        }, function(err) {
            responseBody.text(`Error sending message: ${formatJson(err)}`);
        });
    });

    btnLogClear.click(function() {
        logOutput.text(" ");
    });

    function doMonitor(mon)  {
        $.getJSON(`/worker/monitor/${workerId}/${mon}`, function (data) {
            d(`Monitor: ${mon}`);
        });
    }

    chkMonitor.click(function() {
        let checked = $(this).is(":checked");
        d(`checked=${checked}`);
        if(checked) {
            doMonitor(true);
        } else {
            doMonitor(false);
        }
    });

    workerTitle.text(workerId);
}

