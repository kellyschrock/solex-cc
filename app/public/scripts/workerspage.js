
function WorkersPage() {
    var tableWorkers = $("#tbl_workers");
    var fileUpload = $("#fileupload");
    var reloadButton = $("#btn_reload");
    var startStopButton = $("#btn_start_stop");
    var mRunning = false;

    function loadWorkersTable(workers) {
        tableWorkers.find("tr:gt(0)").remove();

        if (workers) {
            $.each(workers, function (idx, item) {
                if(item.id) {
                    var mavlinkMessages = "";

                    if(item.mavlinkMessages) {
                        for(var i = 0, size = item.mavlinkMessages.length; i < size; ++i) {
                            mavlinkMessages += item.mavlinkMessages[i] + " ";
                        }
                    }

                    var row = "<tr>" + 
                        "<td class=\"nr bold smaller\" cid=\"" + item.id + "\">" + item.id + "</td>" +
                        "<td class=\"smaller\">" + item.name + "</td>" +
                        "<td class=\"smaller\">" + item.description + "</td>" +
                        "<td class=\"smaller\">" + mavlinkMessages + "</td>" +
                        "<td><button class=\"del btn btn-danger btn-sm\">Remove</button></td></tr>"
                        ;

                    row += "</tr>";

                    $("#tbl_workers tr:last").after(row);                        
                }
            });
        }

        $("#tbl_workers .del").click(function () {
            var td = $(this).closest("tr").find(".nr");
            var name = td.text();
            if (confirm("Remove worker " + name + "?")) {
                var idx = td.parent().index() - 1;

                if (idx >= 0) {
                    deleteWorker(name);
                }
            }
        });
    }

    function deleteWorker(workerId) {
        if(workerId) {
            $.ajax({
                url: '/worker/' + workerId,
                type: 'DELETE',
                success: function (result) {
                    loadWorkers();
                }
            });
        }
    }

    function promptToInstall(workerData) {
        var str = "Install " + workerData.name + ", " + workerData.size + " bytes?";

        if(confirm(str)) {
            var body = {
                name: workerData.name,
                path: workerData.path,
                target: workerData.target
            };

            post("/worker/install", body, function(data) {
                setTimeout(function() {
                    reloadButton.click();
                }, 2000);
            }, function(err) {
                alert("Unable to install the worker.");
            })
        }
    }

    function initFileUpload() {
        var url = "/worker/upload";

        console.log(fileUpload);

        fileUpload.fileupload({
            url: url,
            done: function (err, data) {
                if(data && data.result) {
                    if(data.result.message) {
                        alert("Error: " + data.result.message);
                    } else {
                        promptToInstall(data.result);
                    }
                }
            },
            progressall: function (e, data) {
                // TODO: Get a progress bar in place for this.
                var progress = parseInt(data.loaded / data.total * 100, 10);
                $('#progress .progress-bar').css(
                    'width',
                    progress + '%'
                );
            }
        })
        .prop('disabled', !$.support.fileInput)
        .parent().addClass($.support.fileInput ? undefined : 'disabled');
    }

    function loadWorkers() {
        $.getJSON("/workers", function(data) {
            loadWorkersTable(data);
        });
    }

    function loadPage() {

        function setStartButtonState() {
            if(mRunning) {
                startStopButton.removeClass("btn-success").addClass("btn-danger").text("Stop");
            } else {
                startStopButton.removeClass("btn-danger").addClass("btn-success").text("Start");
            }
        }

        $.get("/dispatch/running", function(data) {
            mRunning = data.running;
            setStartButtonState();

            startStopButton.click(function() {
                if(mRunning) {
                    $.get("/dispatch/stop", function(data) {
                        mRunning = false;
                        setStartButtonState();
                    });
                } else {
                    $.get("/dispatch/start", function (data) {
                        mRunning = true;
                        setStartButtonState();
                    });
                }
            });
        });

        reloadButton.click(function() {
            $.get("/dispatch/reload", function() {
                console.log("reloaded");
                loadWorkers();
            });
        });

        initFileUpload();
        loadWorkers();
    }

    loadPage();
}

$(document).ready(function () {
    WorkersPage();
});
