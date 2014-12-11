var beforeHook = function (docOrModifier, template, docId) {
  if(docId!=null)
  {
    var isUpdate = true;
    // Util.deepFind uses a path to find if the key is set
    // In the update-case, the key is nested in the $set-object
    // we therefore introduce a helperVariable: 
    var docData = docOrModifier['$set'];
  }
  else
  {
    var isUpdate = false;
    var docData = docOrModifier;
  }
  var self = this;
  if (!AutoForm.validateForm(this.formId)) {
    return false;
  }
       

  // Loop through all hidden file inputs in the form.
  var totalFiles = 0;
  var arrayFields = {};
  template.$('.cfsaf-hidden').each(function () {
    var elem = $(this);

    // Get schema key that this input is for
    var key = elem.attr("data-schema-key");

    // no matter what, we want to delete the dummyId value
    //delete docData[key];
    CfsAutoForm.Util.deepDelete(docData,key);
 
    // Get list of files that were attached for this key
    var fileList = elem.data("cfsaf_files");

    // If we have some attached files
    if (fileList) {
      // add all files to total count
      totalFiles += fileList.length;
    }

    // Otherwise it might be a multiple files field
    else {
      var fileListList = elem.data("cfsaf_files_multi");
      if (fileListList) {
        // make a note that it's an array field
        arrayFields[key] = true;
        // add all files to total count
        _.each(fileListList, function (fileList) {
          totalFiles += fileList.length;
        });
        // prep the array
        docOrModifier[key] = [];
      }
    }
  });

  // If no files were attached anywhere on the form, we're done.
  // We pass back the docOrModifier synchronously
  if (totalFiles === 0) {
    return docOrModifier;
  }

  // Create the callback that will be called either
  // upon file insert error or upon each file being uploaded.
  var doneFiles = 0;
  var failedFiles = 0;
  function cb(error, fileObj, key) {
    // Increment the done files count
    doneFiles++;

    // Increment the failed files count if it failed
    if (error) {
      failedFiles++;
    }

    // If it didn't fail, set the new ID as the property value in the docData,
    // or push it into the array of IDs if it's a multiple files field.
    else {
      if (arrayFields[key]) {
        CfsAutoForm.Util.deepFind(docData,key).push(fileObj._id);
      } else {
        //docOrModifier[key] = fileObj._id;
        CfsAutoForm.Util.deepSet(docData,key,fileObj._id);
      }
    }

    // If this is the last file to be processed, pass execution back to autoform
    if (doneFiles === totalFiles) {
      // If any files failed
      if (failedFiles > 0) {
        // delete all that succeeded
        CfsAutoForm.deleteUploadedFiles(template);
        // pass back to autoform code, telling it we failed
        self.result(false);
      }
      // Otherwise if all files succeeded
      else {
        // pass updated docOrModifier back to autoform code, telling it we succeeded
        self.result(docOrModifier);
      }
    }
  }

  // Loop through all hidden file fields, inserting
  // and uploading all files that have been attached to them.
  template.$('.cfsaf-hidden').each(function () {
    var elem = $(this);

    // Get schema key that this input is for
    var key = elem.attr("data-schema-key");

    // Get the FS.Collection instance
    var fsCollectionName = elem.attr("data-cfs-collection");
    var fsCollection = FS._collections[fsCollectionName];

    // delete old files assigned to this field
    if(isUpdate)
    {
      // get the form's collection
      var formCollection = self.template.data.collection;
      if(_.isString(formCollection))
      {
        formCollection = window[formCollection];
      }

      if(formCollection instanceof Meteor.Collection)
      {
        var oldDocument = formCollection.findOne(docId);
        if(oldDocument) {
          var oldFiles = oldDocument[key];
          if(!_.isArray(oldFiles))
          {
            oldFiles = [oldFiles];
          }
          // delete the old files
          if(isUpdate)
          {
            _.each(oldFiles, function(id){
              fsCollection.remove(id);
            });


          }
        }
      }
    }
    // Loop through all files that were attached to this field
    function loopFileList(fileList) {
      _.each(fileList, function (file) {
        // Create the FS.File instance
        var fileObj = new FS.File(file);

        // Listen for the "uploaded" event on this file, so that we
        // can call our callback. We want to wait until uploaded rather
        // than just inserted. XXX Maybe should wait for stored?
        fileObj.once("uploaded", function () {
          // track successful uploads so we can delete them if any
          // of the other files fail to upload
          var uploadedFiles = elem.data("cfsaf_uploaded-files") || [];
          uploadedFiles.push(fileObj);
          elem.data("cfsaf_uploaded-files", uploadedFiles);
          // call callback
          cb(null, fileObj, key);
        });

        // Insert the FS.File instance into the FS.Collection
        fsCollection.insert(fileObj, function (error, fileObj) {
          // call callback if insert/upload failed
          if (error) {
            cb(error, fileObj, key);
          }
          // TODO progress bar during uploads
        });
      });
    }

    // single fields first
    loopFileList(elem.data("cfsaf_files"));
    // then multiple fields
    _.each(elem.data("cfsaf_files_multi"), function (fileList) {
      loopFileList(fileList);
    });
  });
};

Hooks = {

  beforeUpdate: function(docId, modifier, template) {


    return beforeHook.call(this, modifier, template, docId);
  },


  afterUpdate: function (error, result, template) {
    return Hooks.afterInsert.call(this, error, result, template);
  },

  
  beforeInsert: function(doc, template)
  {
   return beforeHook.call(this, doc, template, null);
  },
  afterInsert: function (error, result, template) {
  var elems = template.$('.cfsaf-hidden');
  if (error) {
    CfsAutoForm.deleteUploadedFiles(template);
    if (FS.debug || AutoForm._debug)
      console.log("There was an error inserting so all uploaded files were removed.", error);
  } else {
      // cleanup files data
      elems.removeData("cfsaf_files");
      elems.removeData("cfsaf_files_multi");
    }
    // cleanup uploaded files data
    elems.removeData("cfsaf_uploaded-files");
  }
};