
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
    let btnConfigPanel = $("#btn_config_panel");
    let tblConfig = $("#tbl_config");

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
        const config = {};

        function saveRowEdit(id, edit) {
            const value = edit.val();

            $(`tr#${id} td.value`).html(value);
            config[id] = value;
        }

        function cancelEditRow(id, value) {
            $(`tr#${id} td.value`).html(value);
        }

        function bindDeleteButtons() {
            $(`button.del`).unbind().click(function () {
                const id = $(this).attr("pid");

                if (confirm(`Delete property ${id}?`)) {
                    delete config[id];
                    $(`tr#${id}`).remove();
                }
            });
        }

        function editRowAt(id, value) {
            $(`tr#${id} td.value`).html("").append(`<input type="text" id="edit_${id}" class="row_edit" value="${value}">`);
            $(`#edit_${id}`).focus().on("keydown", (e) => {
                console.log(e.which);
                switch (e.which) {
                    case 13: saveRowEdit(id, $(`#edit_${id}`)); break;
                    case 27: cancelEditRow(id, value); break;
                }
            });

            $(`#edit_${id}`).select();
        }

        $("#btn_add_property").click(function() {
            const prop = prompt(`Enter a property name.`);
            if(prop) {
                if(prop.indexOf(" ") >= 0) {
                    return alert("Need to use a name without spaces in it.");
                }
                
                const row = `<tr id="${prop}">
                        <th class="nr">${prop}</th>
                        <td class="value">Edit this value</td>
                        <td>
                            <button pid="${prop}" class="del btn btn-danger btn-sm">Delete</button>
                        </td>
                        </tr>`
                        ;
                $("#tbl_config tr:last").after(row);

                bindDeleteButtons();
                editRowAt(prop, "New value");
            }
        });

        $("#btn_save_config").click(function() {
            postJSON(`/worker/config/${workerId}`, JSON.stringify(config), 
                function(response) {

                }, 
                function(response) {
                    alert(`Unable to save properties: ${JSON.stringify(response)}`);
                });
        });

        // Turns out the () => style of functions doesn't work. $(this) is invalid. 
        $("#tbl_config").on("dblclick", "tr", function () {
            const id = $(this).attr("id");
            const value = $(`tr#${id} td.value`).html();
            editRowAt(id, value);
        });

        $.getJSON(`/worker/details/${workerId}`, function (data) {
            // d(JSON.stringify(data));
            workerTitle.text(data.name);
            workerDesc.text(data.description);

            if(data.config) {
                Object.assign(config, data.config);

                $("#tbl_config").find().remove();

                for(let prop in config) {
                    const row = `<tr id="${prop}">
                        <th class="nr">${prop}</th>
                        <td class="value">${config[prop]}</td>
                        <td>
                            <button pid="${prop}" class="del btn btn-danger btn-sm">Delete</button>&nbsp;
                        </td>
                        </tr>`
                        ;

                    $("#tbl_config tr:last").after(row);
                }
            }

            bindDeleteButtons();
        });
    }

    addWebSocketListener(webSocketListener);
    subscribeWsGCSMessages();
    subscribeWsLogMessages();
    subscribeMonitor();
    loadWorker(workerId);

    btnConfigPanel.click(function() {
        if(tblConfig.is(":visible")) {
            tblConfig.hide();
            btnConfigPanel.text("Expand");
        } else {
            tblConfig.show();
            btnConfigPanel.text("Collapse");
        }
    });

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

