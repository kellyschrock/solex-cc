
function WorkersPage() {
    var tableWorkers = $("#tbl_workers");

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

                    var row = "<tr><td class=\"nr bold\" cid=\"" + item.id + "\">" + item.name + "</td>" +
                        "<td>" + item.id + "</td>" +
                        "<td>" + item.description + "</td>" +
                        "<td>" + item.looper + "</td>" +
                        "<td>" + mavlinkMessages + "</td>"
                        ;

                    row += "</tr>";

                    $("#tbl_configs tr:last").after(row);                        
                }
            });

            // tableWorkers.click(function () {
            //     var td = $(this).closest("tr").find(".nr");
            //     var id = td.attr("cid");
            //     loadNetConfig(id);
            // });

            // $("#tbl_workers .use").click(function () {
            //     var td = $(this).closest("tr").find(".nr");
            //     var id = td.attr("cid");
            //     var name = td.text();

            //     if (confirm("Apply configuration " + name + "?")) {
            //         var idx = td.parent().index() - 1;

            //         if (idx >= 0) {
            //             var config = mNetConfigs[idx];
            //             applyNetConfig(id);
            //         }
            //     }
            // });

            // $("#tbl_workers .del").click(function () {
            //     var td = $(this).closest("tr").find(".nr");
            //     var id = td.attr("cid");
            //     var name = td.text();

            //     if (confirm("Delete configuration " + name + "?")) {
            //         var idx = td.parent().index() - 1;

            //         if (idx >= 0) {
            //             deleteNetConfig(id);
            //         }
            //     }
            // });
        }
    }

    function loadWorkers() {
        $.getJSON("/workers", function(data) {
            loadWorkersTable(data);
        });
    }

    function loadPage() {
        loadWorkers();
    }

    loadPage();
}

$(document).ready(function () {
    WorkersPage();
});
