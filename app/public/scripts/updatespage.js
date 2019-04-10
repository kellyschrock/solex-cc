
function UpdatesPage() {
    var fileUpload = $("#fileupload");
    // var installButton = $("#install");

    function loadPage() {
        // Disable install button until a file upload succeeds.
        // enable(installBtton, false);

        // $.getJSON("/dispatch/log_filter", function(data) {
        //     var workerIds = data.worker_ids;
        //     mLogWorkersText.val(workerIds);
        // });

        initFileUpload();
    }

    function initFileUpload() {
        var url = "/sys/update/upload";

        console.log(fileUpload);

        fileUpload.fileupload({
            url: url,
            done: function (err, data) {
                if (data && data.result) {
                    if (data.result.message) {
                        alert(`Error: ${data.result.message}`);
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

    function promptToInstall(data) {
        var str = `Install ${data.name} (${data.size} bytes)?`;

        if (confirm(str)) {
            let body = {
                name: data.name,
                path: data.path
            };

            post("/sys/update/install", body, function (data) {
                alert(data.message);
            }, function (err) {
                alert(`Unable to install the update. An unknown error occurred.`);
            })
        }
    }

    loadPage();
}

$(document).ready(function () {
    UpdatesPage();
});
