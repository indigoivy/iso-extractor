importScripts('jsstruct.js')

function rtrim(s,thing)
{
    var r=s.length -1;
    while(r > 0 && s[r] == thing)
    {r-=1;}
    return s.substring(0, r+1);
}


self.addEventListener('message', function(evt) {
    self.lastMessage = evt.data
    console.log('worker got message',evt)
    if (evt.data.command == 'parse') {
        var file = evt.data.file
        var isofile = new ISO9660(file)
        console.log('got isofile', isofile)
    }
    self.postMessage({msg:'thanks!'})
    
/*
    if (transferable) {
        self.postMessage({hash:new Uint8Array(result), _id:id, chunks:msg.chunks}, returnchunks)
    } else {
        self.postMessage({hash:new Uint8Array(result), _id:id})
    }
*/

})


function FileWrapper(file, slicea, sliceb) {
    this.fr = new FileReaderSync
    this.file = file
    this.pos = slicea || 0
    this.sliceb = sliceb
}
FileWrapper.prototype = {
    seek: function(idx) {
        this.pos = pos
    },
    read: function(length, type) {
        type = type || 'ArrayBuffer'
        var sliceEnd = Math.min(this.sliceb, this.pos + length)
        var buf = this.fr['readAs' + type]( this.file.slice( this.pos, sliceEnd ) )
        this.pos += length
        return buf
    }
}

function ISO9660(file) {
    this._buff = null
    this._root = null
    this._pvd = {}
    this._paths = []

    this._file = file
    this._get_sector = this._get_sector_file

    // Volume Descriptors
    var ty
    var sector = 0x10
    while (true) {
        console.log('getting sector',sector)
        this._get_sector(sector, 2048)
        sector += 1
        ty = this._unpack('B')

        if (ty == 1) {
            this._unpack_pvd()
        } else if (ty == 255) {
            break
        } else {
            continue
        }
    }

    // Path table
    var p,l0,l1,l2

    l0 = this._pvd['path_table_size']
    this._get_sector(this._pvd['path_table_l_loc'], l0)

    while (l0 > 0) {
        p = {}
        l1 = this._unpack('B')
        l2 = this._unpack('B')
        p['ex_loc'] = this._unpack('<I')
        p['parent'] = this._unpack('<H')
        p['name']   = this._unpack_string(l1)
        if (p['name'].charCodeAt(0) == 0) {
            p['name'] = ''
        }

        if (l1%2 == 1) {
            this._unpack('B')
        }

        this._paths.push(p)

        l0 -= 8 + l1 + (l1 % 2)
    }
    console.assert( l0 == 0 )
}

ISO9660.prototype = {
    _get_sector_file: function(sector, length) {
        //var f = new FileWrapper(this._file)
        this._buff = new FileWrapper(this._file, sector*2048, sector*2048 + length)
    },
    _unpack: function(st) {
        var d
        if (st[0] == '<' || st[0] == '>') {
        } else {
            st = '<' + st
        }
        d = jsstruct.unpack(st, this._buff.read(jsstruct.calcsize(st)))
        if (st.length == 2) {
            return d[0]
        } else {
            return d
        }
    },
    _unpack_pvd: function() {
        this._pvd['type_code']                     = this._unpack_string(5)
        this._pvd['standard_identifier']           = this._unpack('B')
        this._unpack_raw(1)                        //discard 1 byte
        this._pvd['system_identifier']             = this._unpack_string(32)
        this._pvd['volume_identifier']             = this._unpack_string(32)
        this._unpack_raw(8)                        //discard 8 bytes
        this._pvd['volume_space_size']             = this._unpack_both('i')
        this._unpack_raw(32)                       //discard 32 bytes
        this._pvd['volume_set_size']               = this._unpack_both('h')
        this._pvd['volume_seq_num']                = this._unpack_both('h')
        this._pvd['logical_block_size']            = this._unpack_both('h')
        this._pvd['path_table_size']               = this._unpack_both('i')
        this._pvd['path_table_l_loc']              = this._unpack('<i')
        this._pvd['path_table_opt_l_loc']          = this._unpack('<i')
        this._pvd['path_table_m_loc']              = this._unpack('>i')
        this._pvd['path_table_opt_m_loc']          = this._unpack('>i')
        //_, this._root = this._unpack_record()      //root directory record
        this._root = this._unpack_record()[1]
        this._pvd['volume_set_identifer']          = this._unpack_string(128)
        this._pvd['publisher_identifier']          = this._unpack_string(128)
        this._pvd['data_preparer_identifier']      = this._unpack_string(128)
        this._pvd['application_identifier']        = this._unpack_string(128)
        this._pvd['copyright_file_identifier']     = this._unpack_string(38)
        this._pvd['abstract_file_identifier']      = this._unpack_string(36)
        this._pvd['bibliographic_file_identifier'] = this._unpack_string(37)
        this._pvd['volume_datetime_created']       = this._unpack_vd_datetime()
        this._pvd['volume_datetime_modified']      = this._unpack_vd_datetime()
        this._pvd['volume_datetime_expires']       = this._unpack_vd_datetime()
        this._pvd['volume_datetime_effective']     = this._unpack_vd_datetime()
        this._pvd['file_structure_version']        = this._unpack('B')
    },
    _unpack_string: function(l) {
        var s = this._buff.read(l, 'BinaryString')
        return rtrim(s,' ')
    },
    _unpack_raw: function(l) {
        this._buff.read(l)
    },
    _unpack_record: function(read) {
        read = read || 0
        var l0, l1, d, l2, extra

        l0 = this._unpack('B')

        if (l0 == 0)
            return [read+1, null]

        l1 = this._unpack('B')

        d = {}
        d['ex_loc']               = this._unpack_both('I')
        d['ex_len']               = this._unpack_both('I')
        d['datetime']             = this._unpack_dir_datetime()
        d['flags']                = this._unpack('B')
        d['interleave_unit_size'] = this._unpack('B')
        d['interleave_gap_size']  = this._unpack('B')
        d['volume_sequence']      = this._unpack_both('h')

        l2 = this._unpack('B')
        d['name'] = this._unpack_string(l2).split(';')[0]
        if (d['name'].charCodeAt(0) == 0)
            d['name'] = ''

        if (l2 % 2 == 0)
            this._unpack('B')

        t = 34 + l2 - (l2 % 2)

        e = l0-t
        if (e>0)
            extra = this._unpack_raw(e)

        return [read+l0, d]
    },

    _unpack_both: function(st) {
        var a,b
        a = this._unpack('<'+st)
        b = this._unpack('>'+st)
        console.assert( a == b )
        return a
    },

    _unpack_dir_datetime: function() {
        return this._unpack_raw(7)
    },

    _unpack_vd_datetime: function() {
        return this._unpack_raw(17)
    },

}
