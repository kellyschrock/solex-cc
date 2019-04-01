
function WorkersPage() {
    var tableWorkers = $("#tbl_workers");
    var tablePackages = $("#tbl_packages");
    var tableLoadErrors = $("#tbl_load_errors");
    var loadErrorsView = $("#div_load_errors");
    var fileUpload = $("#fileupload");
    var reloadButton = $("#btn_reload");
    var startStopButton = $("#btn_start_stop");
    var restartButton = $("#btn_restart_service");
    var mRunning = false;

    function loadLoadErrorsTable(errors) {
        tableLoadErrors.find("tr:gt(0)").remove();

        var show = errors && errors.length > 0;

        if(show) {
            loadErrorsView.show();
            $.each(errors, function(idx, item) {
                var row = "<tr>" +
                    "<td class=\"smaller\">" + item.path + "</td>" + 
                    "<td class=\"smaller\">" + item.error + "</td>" + 
                    "<td class=\"smaller\">" + item.detail + "</td>"
                    ;

                $("#tbl_load_errors tr:last").after(row);
            });
        } else {
            loadErrorsView.hide();
        }
    }

    function loadWorkersTable(workers) {
        tableWorkers.find("tr:gt(0)").remove();
        tablePackages.find("tr:gt(0)").remove();

        function ellipsize(text, max) {
            return (text.length > max)?
                text.substring(0, max) + "...": text;
        }

        if (workers) {
            var packages = {};
            var hasPackages = false;

            $.each(workers, function (idx, item) {
                if(item.id) {
                    var enableDisableButton = (item.enabled)?
                        "<button class=\"disable btn btn-warning btn-sm\">Disable</button>":
                        "<button class=\"enable btn btn-success btn-sm\">Enable</button>"
                        ;

                    function packageTip(p) {
                        return `${p.name}: ${p.description}`;
                    }

                    var name = item.name;
                    if(item.parent_package) {
                        name += " <span class=\"smallest hilite\" title=\"" + packageTip(item.parent_package) + "\">(" + item.parent_package.id + ")</span>";

                        packages[item.parent_package.id] = item.parent_package;
                        hasPackages = true;
                    }

                    var row = "<tr>" + 
                        "<td class=\"nr bold smaller\" cid=\"" + item.id + "\">" + item.id + "</td>" +
                        "<td class=\"smaller\">" + name + "</td>" +
                        "<td class=\"small\" title=\"" + item.description + "\">" + ellipsize(item.description, 30) + "</td>" +
                        "<td>" + 
                        "<button class=\"reload btn btn-info btn-sm\">Reload</button>&nbsp;" + 
                        "<button class=\"del btn btn-danger btn-sm\">Remove</button>&nbsp;" + 
                        enableDisableButton + 
                        "</td>" +
                        "</tr>"
                        ;

                    $("#tbl_workers tr:last").after(row);
                }
            });

            if(hasPackages) {
                function hasEnabledWorkers(packageId) {
                    for(var i = 0, size = workers.length; i < size; ++i) {
                        if(workers[i].parent_package && workers[i].parent_package.id === packageId && workers[i].enabled) {
                            return true;
                        }
                    }

                    return false;
                }

                $.each(packages, function (idx, item) {
                    if (item.id) {
                        var ed = (hasEnabledWorkers(item.id)) ?
                            "<button class=\"disable btn btn-warning btn-sm\">Disable</button>" :
                            "<button class=\"enable btn btn-success btn-sm\">Enable</button>"
                            ;

                        var row = "<tr>" +
                            "<td class=\"nr bold smaller\" cid=\"" + item.id + "\">" + item.id + "</td>" +
                            "<td class=\"smaller\">" + item.name + "</td>" +
                            "<td class=\"small\" title=\"" + item.description + "\">" + ellipsize(item.description, 50) + "</td>" +
                            "<td>" +
                            "<button class=\"del btn btn-danger btn-sm\">Remove</button>&nbsp;" +
                            ed +
                            "</td>" +
                            "</tr>"
                            ;

                        $("#tbl_packages tr:last").after(row);
                    }
                });

                $("#div_packages").show();
            } else {
                $("#div_packages").hide();
            }
        }

        function enableWorker(workerId, enable) {
            $.getJSON(`/dispatch/worker/enable/${workerId}/${enable}`, function (data) {
                loadWorkers();
            });
        }

        function enablePackage(packageId, enable) {
            $.getJSON(`/dispatch/package/enable/${packageId}/${enable}`, function (data) {
                loadWorkers();
            });
        }

        $("#tbl_workers .nr").click(function () {
            let td = $(this).closest("tr").find(".nr");
            let name = td.text();

            // Open a detail page for this worker.
            loadView("worker_detail.html", function() {
                WorkerDetailPage(name);
            });
        });

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

        $("#tbl_workers .reload").click(function () {
            var td = $(this).closest("tr").find(".nr");
            var name = td.text();
            reloadWorker(name);
        });

        $("#tbl_workers .enable").click(function () {
            var td = $(this).closest("tr").find(".nr");
            var name = td.text();
            enableWorker(name, true);
        });

        $("#tbl_workers .disable").click(function () {
            var td = $(this).closest("tr").find(".nr");
            var name = td.text();
            enableWorker(name, false);
        });

        $("#tbl_packages .del").click(function () {
            var td = $(this).closest("tr").find(".nr");
            var name = td.text();
            if (confirm("Remove package " + name + "?? All workers in the selected package will be removed!")) {
                var idx = td.parent().index() - 1;

                if (idx >= 0) {
                    deletePackage(name);
                }
            }
        });

        $("#tbl_packages .enable").click(function () {
            var td = $(this).closest("tr").find(".nr");
            var name = td.text();
            enablePackage(name, true);
        });

        $("#tbl_packages .disable").click(function () {
            var td = $(this).closest("tr").find(".nr");
            var name = td.text();
            enablePackage(name, false);
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

    function reloadWorker(workerId) {
        if(workerId) {
            $.ajax({
                url: '/worker/reload/' + workerId,
                type: 'GET',
                success: function (result) {
                    // loadWorkers();
                }
            });
        }
    }

    function deletePackage(packageId) {
        if (packageId) {
            $.ajax({
                url: '/package/' + packageId,
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
                if(data.success) {
                    setTimeout(function () {
                        loadWorkers();
                    }, 2000);
                } else {
                    alert(data.message + "\nCommand output:\n" + data.command_output);
                }
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
            loadWorkersTable(data.workers);
            loadLoadErrorsTable(data.load_errors);
        });
    }

    function loadPage() {

        function setStartButtonState() {
            if(mRunning) {
                startStopButton.removeClass("btn-success").addClass("btn-danger").text("Stop Dispatcher");
            } else {
                startStopButton.removeClass("btn-danger").addClass("btn-success").text("Start Dispatcher");
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

        restartButton.click(function() {
            console.log("restartButton.click()");
            
            if(confirm("Restart the service?")) {
                $.get("/sys/restart", function(data) {
                    setTimeout(function() {
                        loadPage();
                    }, 5000);
                });
            }
        })

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
